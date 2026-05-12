// Run: node generate-keys.js 10
// Generates N valid PrepAura license keys

const count = parseInt(process.argv[2]) || 5;

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  while (true) {
    const parts = [0, 0, 0].map(() =>
      Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    );
    const full = `PREP-${parts.join('-')}`;
    const sum = full.replace(/-/g, '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    if (sum % 11 === 0) return full;
  }
}

console.log(`\n✦ PrepAura License Keys (${count}):\n`);
for (let i = 0; i < count; i++) {
  console.log(`  ${generateKey()}`);
}
console.log('\nDeliver one key per customer via email.\n');
