'use strict';
// Anchor-based text patching that respects a file's own line endings (the checkout is CRLF on Windows).
const fs = require('fs');
module.exports = function patch(file, edits) {
  let s = fs.readFileSync(file, 'utf8');
  const crlf = s.includes('\r\n');
  const eol = (t) => (crlf ? t.replace(/\r?\n/g, '\r\n') : t);
  for (const [a0, b0, label] of edits) {
    const a = eol(a0), b = eol(b0);
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${file}: anchor "${label}" found ${n} times`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(file, s);
};
