module.exports = {
  root: true,
  env: { es6: true, browser: true, node: false },
  globals: {
    SpreadsheetApp: 'readonly',
    PropertiesService: 'readonly',
    DriveApp: 'readonly',
    UrlFetchApp: 'readonly',
    ScriptApp: 'readonly',
    HtmlService: 'readonly',
    Logger: 'readonly'
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': 'off',
    'no-undef': 'off'
  }
};