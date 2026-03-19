class HttpInstrumentation {
  constructor(_config = {}) {
    this._config = _config;
  }

  setConfig(config = {}) {
    this._config = config;
  }

  setTracerProvider(_tracerProvider) {}

  setMeterProvider(_meterProvider) {}

  setLoggerProvider(_loggerProvider) {}

  enable() {}

  disable() {}
}

module.exports = {
  HttpInstrumentation,
};
