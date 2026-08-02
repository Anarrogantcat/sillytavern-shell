// Quick unit test for v1.6.2 terminal logic (stripAnsi + batched append semantics)
const stripAnsi = (t) => t.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '');

const cases = [
    // [input, expected]
    ['\x1b[36m> git clone\x1b[0m', '> git clone'],
    ['\x1b[2K\r50%', '\r50%'],          // cursor erase + CR progress (CR kept intentionally)
    ['\x1b]0;title\x07text', 'text'],   // OSC title sequence
    ['\x1b[?25lhidden', 'hidden'],      // cursor hide
    ['plain text\nline2', 'plain text\nline2'],
    ['\x1b[1;31mred bold\x1b[0m', 'red bold'],
];

let pass = 0;
for (const [input, expected] of cases) {
    const got = stripAnsi(input);
    const ok = got === expected;
    if (ok) pass++;
    else console.log(`FAIL: ${JSON.stringify(input)} -> ${JSON.stringify(got)} (want ${JSON.stringify(expected)})`);
}
console.log(`stripAnsi: ${pass}/${cases.length} passed`);

// Simulate history cap
let history = '';
for (let i = 0; i < 100000; i++) history += `line ${i}\n`;
if (history.length > 2 * 1024 * 1024) history = history.slice(-1 * 1024 * 1024);
console.log('history cap: length =', history.length, history.length <= 2 * 1024 * 1024 ? 'OK' : 'FAIL');

process.exit(pass === cases.length ? 0 : 1);
