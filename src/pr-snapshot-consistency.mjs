import { createHash } from 'node:crypto';

const REPO = 'deenkids7-dev/deenkids';
const REPO_ID = 1282086207;
const SHA40 = /^[0-9a-f]{40}$/;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_CHANGED_FILES = 100;

function deny(code) { throw new Error(code); }
function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

const SAFE_PATH=/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
// Stacked branch deltas are allowed only in an explicitly scoped, COMMENTED-only
// advisory call. This option must never be enabled by an approving reviewer.
function validAdvisoryStackedBase(ref) {
  return typeof ref==='string' && /^codex\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(ref) &&
    !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/');
}

/**
 * GitHub text diff must have one complete and parseable header and at least
 * one hunk for EACH changed file. Unrecognized rename, binary, whitespace-
 * quoted paths or hunkless files are deliberately BLOCKED, not accepted.
 */
function checkDiffCoverage(text, expectedCount) {
  let file=null, count=0, oldRemaining=0, newRemaining=0, inHunk=false;
  let previousOldEnd=-1,previousNewEnd=-1,previousHunk=false;
  const seen=new Set();
  function finishHunk() {
    if(inHunk && (oldRemaining!==0 || newRemaining!==0))
      deny('GITHUB_DIFF_HUNK_LENGTH_MISMATCH');
    inHunk=false;
  }
  function finishFile() {
    if(!file) return;
    finishHunk();
    if(!file.oldHeader || !file.newHeader || !file.hunkSeen)
      deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
  }
  for(const line of text.split('\n')) {
    if(line.startsWith('diff --git ')) {
      finishFile();
      const m=line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
      if(!m || m[1]!==m[2] || !SAFE_PATH.test(m[1]) || seen.has(m[1]))
        deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
      seen.add(m[1]); count++;
      file={path:m[1],oldHeader:false,newHeader:false,hunkSeen:false};
      oldRemaining=0;newRemaining=0;inHunk=false;
      previousOldEnd=-1;previousNewEnd=-1;previousHunk=false;
      continue;
    }
    if(!file) {
      if(line!=='') deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
      continue;
    }
    if(line.startsWith('@@ ')) {
      finishHunk();
      if(!file.oldHeader || !file.newHeader)
        deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
      const m=line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/);
      if(!m) deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
      const oldStart=Number(m[1]), newStart=Number(m[3]);
      oldRemaining=m[2]===undefined?1:Number(m[2]);
      newRemaining=m[4]===undefined?1:Number(m[4]);
      if(![oldStart,newStart,oldRemaining,newRemaining].every(Number.isSafeInteger) ||
        oldRemaining>100000 || newRemaining>100000 ||
        (oldRemaining===0 && newRemaining===0)) {
        deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
      }
      // Fail closed on overlapping/nonmonotonic hunk source coordinates:
      // otherwise a forged diff can cite changed lines more than once.
      if((oldRemaining>0&&oldStart===0)||
         (newRemaining>0&&newStart===0)||
         (previousHunk&&(oldStart<previousOldEnd||
           newStart<previousNewEnd)))
        deny('GITHUB_DIFF_HUNK_ORDER_INVALID');
      previousOldEnd=oldStart+oldRemaining;
      previousNewEnd=newStart+newRemaining;
      if(!Number.isSafeInteger(previousOldEnd)||
         !Number.isSafeInteger(previousNewEnd))
        deny('GITHUB_DIFF_HUNK_ORDER_INVALID');
      previousHunk=true;
      file.hunkSeen=true;inHunk=true;
      continue;
    }
    if(inHunk) {
      if(line.startsWith('\\ No newline at end of file')) continue;
      if(line==='') {
        // Only the final split after the terminating newline is valid.
        // A bare blank line in a hunk is not an encoded diff line.
        if(oldRemaining===0 && newRemaining===0)continue;
        deny('GITHUB_DIFF_HUNK_LENGTH_MISMATCH');
      }
      const prefix=line[0];
      if(prefix===' ') {oldRemaining--;newRemaining--;}
      else if(prefix==='-') oldRemaining--;
      else if(prefix==='+') newRemaining--;
      else deny('GITHUB_DIFF_HUNK_LENGTH_MISMATCH');
      if(oldRemaining<0 || newRemaining<0)
        deny('GITHUB_DIFF_HUNK_LENGTH_MISMATCH');
      continue;
    }
    if(line.startsWith('--- ')) {
      if(file.oldHeader || (line!=='--- a/'+file.path && line!=='--- /dev/null'))
        deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
      file.oldHeader=true;
      continue;
    }
    if(line.startsWith('+++ ')) {
      if(!file.oldHeader || file.newHeader ||
         (line!=='+++ b/'+file.path && line!=='+++ /dev/null'))
        deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
      file.newHeader=true;
      continue;
    }
    // Git's metadata header occurs only before ---/+++ in a file.
    if(!file.oldHeader &&
      /^(?:index |new file mode |deleted file mode |old mode |new mode )/.test(line)) continue;
    if(line!=='')deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
  }
  finishFile();
  if(count!==expectedCount) deny('GITHUB_DIFF_COVERAGE_UNVERIFIED');
}

function extractMetadata(document, requestedPr, allowAdvisoryStackedBase=false) {
  if (!isObject(document) || !isObject(document.head) ||
      !isObject(document.base) || !isObject(document.base.repo) ||
      !isObject(document.head.repo)) {
    deny('INVALID_GITHUB_PR_METADATA');
  }
  if (!Number.isSafeInteger(requestedPr) || requestedPr < 1 ||
      document.number !== requestedPr || document.state !== 'open' ||
      document.merged_at !== null || document.draft !== false ||
      // Target PRIVATE deenkids7-dev/deenkids default branch is master.
      // Publisher PUBLIC devfactory-reviewer-b-publisher uses main; do not
      // mistake its default branch for the reviewed PR's required base.
      (document.base.ref !== 'master' &&
       !(allowAdvisoryStackedBase===true && validAdvisoryStackedBase(document.base.ref))) ||
      document.base.repo.full_name !== REPO ||
      document.base.repo.id !== REPO_ID ||
      document.head.repo.full_name !== REPO ||
      document.head.repo.id !== REPO_ID ||
      (typeof document.head.sha!=='string'||!SHA40.test(document.head.sha)) ||
      (typeof document.base.sha!=='string'||!SHA40.test(document.base.sha)) ||
      !Number.isSafeInteger(document.changed_files) ||
      document.changed_files < 1 || document.changed_files > MAX_CHANGED_FILES) {
    deny('GITHUB_PR_NOT_ELIGIBLE');
  }
  return {
    repository: REPO, repository_id: REPO_ID, pr_number: requestedPr,
    head_sha: document.head.sha, base_sha: document.base.sha,
    base_ref:document.base.ref,changed_files: document.changed_files
  };
}

/**
 * ONLY verifies the internal consistency of input bytes and JSON metadata.
 * The caller MUST obtain all three inputs from the authenticated GitHub API
 * over an independently trusted transport. DO NOT accept PR-author-provided
 * JSON/diff or self-declared status as an authoritative snapshot.
 *
 * No network requests, credentials, permissions, GitHub writes, or approvals.
 * Small text-only PRs by design: unsupported cases are BLOCKED, never PASS.
 */
export function deriveConsistentPrSnapshot({
  requestedPr, metadataBefore, metadataAfter, rawDiff,
  allowAdvisoryStackedBase=false
}) {
  const before = extractMetadata(metadataBefore, requestedPr, allowAdvisoryStackedBase);
  const after = extractMetadata(metadataAfter, requestedPr, allowAdvisoryStackedBase);
  for (const key of ['repository','repository_id','pr_number',
    'head_sha','base_sha','base_ref','changed_files']) {
    if (before[key] !== after[key]) deny('GITHUB_PR_CHANGED_DURING_READ');
  }
  if (!Buffer.isBuffer(rawDiff) ||
      rawDiff.length < 16 || rawDiff.length > MAX_DIFF_BYTES) {
    deny('GITHUB_DIFF_BYTES_UNSUPPORTED');
  }
  const text = rawDiff.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(rawDiff) ||
      /^(?:GIT binary patch|Binary files )/m.test(text)) {
    deny('GITHUB_DIFF_ENCODING_OR_BINARY_UNSUPPORTED');
  }
  // Normalize only the parser view; bind the SHA-256 to original GitHub bytes.
  checkDiffCoverage(text.replace(/\r\n/g,'\n'), before.changed_files);
  return Object.freeze({
    repository:before.repository, repository_id:before.repository_id,
    pr_number:before.pr_number, head_sha:before.head_sha,
    base_sha:before.base_sha,
    ...(allowAdvisoryStackedBase===true && before.base_ref!=='master'
      ? {base_ref:before.base_ref,advisory_stacked:true} : {}),
    diff_sha256:createHash('sha256').update(rawDiff).digest('hex')
  });
}
