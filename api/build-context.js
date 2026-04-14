const { buildAIContext } = require('../src/context/buildAIContext');

module.exports = async function (req, res) {
  try {
    const input = req.body || {};
    const result = buildAIContext(input);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      error: true,
      message: err.message || 'build-context failed'
    });
  }
};
