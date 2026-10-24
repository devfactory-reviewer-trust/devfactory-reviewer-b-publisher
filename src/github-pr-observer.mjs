import { deriveConsistentPrSnapshot } from './pr-snapshot-consistency.mjs';

const URL_PREFIX = 'https://api.github.com/repos/deenkids7-dev/deenkids/pulls/';
const PR_CONTENT_TYPE = /^application\/(?:vnd\.github\+)?json(?:\s*;|$)/i;
const DIFF_CONTENT_TYPE = /^(?:text\/plain|application\/vnd\.github(?:\.v3)?\.diff)(?:\s*;|$)/i;
const SHA40 = /^[0-9a-f]{40}$/;

function deny(code) { throw new Error(code); }
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function checkResult(r, expectedUrl, expectedAccept, maxBytes) {
  if (!isRecord(r) || r.url !== expectedUrl || r.status !== 200 ||
      r.redirected !== false || r.accept !== expectedAccept ||
      !Buffer.isBuffer(r.body) || r.body.length < 1 || r.body.length > maxBytes) {
    deny('UNTRUSTED_GITHUB_RESPONSE');
  }
  return r;
}
function parseMetadata(r, expectedUrl) {
  const response=checkResult(r, expectedUrl, 'application/vnd.github+json', 512 * 1024);
  if (typeof response.contentType !== 'string' ||
      !PR_CONTENT_TYPE.test(response.contentType)) {
    deny('GITHUB_METADATA_MEDIA_TYPE');
  }
  const raw = response.body.toString('utf8');
  if (!Buffer.from(raw,'utf8').equals(response.body)) deny('GITHUB_METADATA_UTF8');
  let metadata;
  try { metadata = JSON.parse(raw); } catch { deny('GITHUB_METADATA_JSON'); }
  return metadata;
}

/**
 * Internal consistency verifier. NEVER verifies the actual origin of a
 * supplied transport. The caller MUST be a separately trusted, authenticated
 * GitHub API client and MUST NOT take requests or JSON from the PR author.
 * There is NO GitHub write or approval path in this module.
 */
export async function observePrSnapshot({ prNumber, request, allowAdvisoryStackedBase=false }) {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 ||
      prNumber > 2147483647 || typeof request !== 'function') {
    deny('INVALID_GITHUB_REQUEST_CONTRACT');
  }
  const url = URL_PREFIX + String(prNumber);
  async function retrieve(accept, maxBytes, requestUrl=url) {
    let r;
    try {
      r = await request(Object.freeze({url:requestUrl, method:'GET', accept, maxBytes}));
    } catch { deny('GITHUB_REQUEST_FAILED'); }
    return checkResult(r, requestUrl, accept, maxBytes);
  }
  const beforeResponse=await retrieve('application/vnd.github+json',512*1024);
  const before=parseMetadata(beforeResponse,url);
  // Read diff from IMMUTABLE commit-to-commit comparison. The mutable PR
  // .diff endpoint can return a different HEAD during an A->B->A race.
  const sha=before?.head?.sha,base=before?.base?.sha;
  if(typeof sha!=='string'||!SHA40.test(sha)||
     typeof base!=='string'||!SHA40.test(base))
    deny('GITHUB_PR_COMMIT_IDENTITY_INVALID');
  const compareUrl='https://api.github.com/repos/deenkids7-dev/deenkids/compare/'+base+'...'+sha;
  const diffResponse=await retrieve('application/vnd.github.diff',2*1024*1024,compareUrl);
  if (typeof diffResponse.contentType !== 'string' ||
      !DIFF_CONTENT_TYPE.test(diffResponse.contentType)) deny('GITHUB_DIFF_MEDIA_TYPE');
  const afterResponse=await retrieve('application/vnd.github+json',512*1024);
  const after=parseMetadata(afterResponse,url);
  const snapshot=deriveConsistentPrSnapshot({
    requestedPr:prNumber,metadataBefore:before,
    metadataAfter:after,rawDiff:diffResponse.body,
    allowAdvisoryStackedBase
  });
  if (!SHA40.test(snapshot.head_sha) || !SHA40.test(snapshot.base_sha)) {
    deny('INVALID_GITHUB_COMMIT_IDENTITY');
  }
  return snapshot;
}
