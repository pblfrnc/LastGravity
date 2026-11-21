const impl = {
  anthropic: require('./anthropic'),
  openai: require('./openai'),
  gemini: require('./gemini'),
  ollama: require('./ollama'),
  mock: require('./mock'),
};

function getProvider(type) {
  const p = impl[type];
  if (!p) throw new Error(`Tipo de provedor desconhecido: ${type}`);
  return p;
}

module.exports = { getProvider };
