const Store = require('electron-store');

const store = new Store({
  schema: {
    apiUrl: { type: 'string', default: '' },
    apiKey: { type: 'string', default: '' },
    computerName: { type: 'string', default: '' },
    computerId: { type: 'string', default: '' },
    pollingInterval: { type: 'number', default: 5000 },
  },
});

module.exports = store;
