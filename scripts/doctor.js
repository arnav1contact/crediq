const required = Number(process.versions.node.split('.')[0]);
if (required < 20) {
  console.error(`Node 20+ is required. Current: ${process.version}`);
  process.exit(1);
}
console.log('CredIQ doctor OK');
console.log(`Node: ${process.version}`);
