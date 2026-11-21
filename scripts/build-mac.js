// Mantido por compatibilidade: use scripts/build-app.js mac [x64|arm64].
process.argv.splice(2, 0, 'mac');
require('./build-app.js');
