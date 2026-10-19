// Fixed synthetic-only holdout: ten NEW semantic/safe scenarios + two
// unchanged reference static guards. No private repository content is read.
// Freeze this fixture set before any model is evaluated against it.
const entry=(label,path,before,source,knownSemanticBug=false,oraclePattern=null)=>
  Object.freeze({label,path,before,source,knownSemanticBug,
    knownStaticBlocker:false,...(knownSemanticBug?{oraclePattern}:{})});
export const HOLDOUT_SEMANTIC_FIXTURES=Object.freeze([
  entry('holdout password reset expiry inversion','src/holdout-reset.mjs',
    'if (now > token.expiresAt) return false;',
    'if (now < token.expiresAt) return false;',true,
    /(?:unexpired|valid|active).{0,60}(?:reject|deny|block)|expired.{0,60}(?:accept|allow)|expiry.{0,60}(?:inver|wrong)|inver.{0,60}expir/i),
  entry('holdout tenant admin guard loosened','src/holdout-tenant.mjs',
    'return user.isAdmin && user.tenantId === target.tenantId;',
    'return user.isAdmin || user.tenantId === target.tenantId;',true,
    /(?:non.?admin|ordinary users?|unauthoriz).{0,70}(?:access|allow|grant)|(?:admin|authoriz|tenant).{0,70}(?:bypass|loosen|weaken)|(?:or).{0,50}(?:admin|tenant).{0,50}(?:permission|access)/i),
  entry('holdout disabled account check inverted','src/holdout-account.mjs',
    'if (account.disabled) return false;',
    'if (!account.disabled) return false;',true,
    /(?:enabled|active).{0,65}(?:reject|block|deny)|disabled.{0,65}(?:allow|accept|grant)|(?:disabled|account).{0,65}(?:invert|reverse)|(?:invert|reverse).{0,65}disabled/i),
  entry('holdout exception handler fails open','src/holdout-error.mjs',
    'catch { return false; }','catch { return true; }',true,
    /fail.?open|(?:error|exception|catch).{0,70}(?:allow|permit|grant|authoriz|return.{0,8}true)|(?:true).{0,40}(?:catch|exception)/i),
  entry('holdout API key redaction removed','src/holdout-secret.mjs',
    'const exposed = redactSecret(config.apiKey);',
    'const exposed = config.apiKey;',true,
    /(?:secret|api.?key|credential).{0,65}(?:expos|leak|plain|unmask|redact)|(?:redact|mask).{0,55}(?:remov|bypass|no longer)/i),
  entry('holdout safe boolean reorder','src/holdout-booleans.mjs',
    'return isPaid === true && isActive === true;',
    'return isActive === true && isPaid === true;'),
  entry('holdout safe boolean coercion','src/holdout-enabled.mjs',
    'const enabled = !!settings.enabled;',
    'const enabled = Boolean(settings.enabled);'),
  entry('holdout defensive display-name access','src/holdout-display.mjs',
    'const displayName = customer.name;',
    'const displayName = customer?.name;'),
  entry('holdout equivalent numeric literal','src/holdout-timeout.mjs',
    'const timeoutMs = 5000;',
    'const timeoutMs = 5_000;'),
  entry('holdout comment-only improvement','src/holdout-comment.mjs',
    '// Memoize the static lookup map.',
    '// Cache the static lookup map.')
]);
export const HOLDOUT_SEMANTIC_LABELS=Object.freeze(HOLDOUT_SEMANTIC_FIXTURES
  .filter(f=>f.knownSemanticBug).map(f=>f.label));
