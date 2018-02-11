import request from "superagent";

export default class Airship {
  constructor(options, cb) {
    this.apiKey = options.apiKey;
    this.envKey = options.envKey;
    this.timeout = options.timeout || 1000;
    this.transformer = options.transformer || (x => x);

    // This is passed a reason.
    this.gatingInfoErrorCb = options.gatingInfoErrorCb || (() => console.error('Airship: failed to retrieve gating info.'));
    this.gatingInfo = null;
    // Used to check whether we are already trying to get gatingInfo.
    this.gatingInfoPromise = null;

    var hardMaxGateStatsBatchSize = 500;
    this.maxGateStatsBatchSize = options.maxGateStatsBatchSize != null // Allow 0 for no batching
      ? Math.min(Math.max(options.maxGateStatsBatchSize, 0), hardMaxGateStatsBatchSize) : hardMaxGateStatsBatchSize;
    this.gateStatsUploadBatchInterval = options.gateStatsUploadBatchInterval != null // Allow 0 for BatchInterval -> immediate
      ? Math.max(options.gateStatsUploadBatchInterval, 0) : 5000; // in milliseconds
    // This is the timer from setInterval for uploading stats. This timer is cleared and recreated
    // when the batch size is reached, ensuring that stats uplead requests are always triggered
    // within options.gateStatsUploadBatchInterval seconds of the event.
    // More than one upload stats requests can simultaneously be in flight (unlike rules)
    this.gateStatsUploadTimeout = null;
    this.gateStatsBatch = [];
    this.triggerUploadStats = this.triggerUploadStats.bind(this);
  }

  // If this is passed a callback as an argument, the arguments null, true will be passed on success,
  // or an Error will be passed on failure.
  // If this is not passed a callback as an argument, this will return a Promise that resolves when
  // initialization is complete.
  init(cb) {
    if (this.gateStatsUploadBatchInterval > 0) {
      this.gateStatsUploadTimeout = setInterval(this.triggerUploadStats, this.gateStatsUploadBatchInterval);
    }

    var getGatingInfoPromise = () => {
      // TODO: get the url for this request
      return request.get("gatingInfo-endpoint")
        .set('Api-Key', this.apiKey)
        .timeout(this.timeout)
    }

    // TODO: remove this fake one
    var getFakeGatingInfoPromise = () => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          var gatingInfo = {
            timestamp: Date.now()
          }
          console.log('Airship: retrieved gatingInfo', gatingInfo)
          resolve(gatingInfo);
        }, 500)
      })
    }

    var maybeGetGatingInfoPromise = () => {
      if (this.gatingInfoPromise) {
        return;
      }

      this.gatingInfoPromise = getFakeGatingInfoPromise().then(gatingInfo => {
        this.gatingInfo = gatingInfo
        this.gatingInfoPromise = null // this code should be in a .finally, but that may not be widely supported
      }).catch(reason => {
        this.gatingInfoPromise = null // this code should be in a .finally, but that may not be widely supported
        this.gatingInfoErrorCb(reason)
        throw reason // TODO: important, need to catch inside the setInterval
      })
      return this.gatingInfoPromise
    }

    var initialGatingInfoPromise = maybeGetGatingInfoPromise();
    setInterval(() => {
      maybeGetGatingInfoPromise().catch(reason => {
        // Catch the error, but ignore or notify.
      })
    }, 3 * 1000);

    if (cb) {
      initialGatingInfoPromise
        .then(() => cb(null, true))
        .catch(() => cb(new Error("Airship: failed to initialize, will re-try in five (5) minutes.")))
      return;
    }

    return initialGatingInfoPromise;
  }

  // TODO: fix babel to triggerUploadStats = () => {
  triggerUploadStats() {
    if (!this.gateStatsBatch.length) {
      return;
    }

    var getUploadStatsPromise = () => {
      var payload = this.gateStatsBatch
      this.gateStatsBatch = []

      // TODO: error handling on triggerUploadStats - do we try again?
      // not right now, but we could add .then() referring to `payload` to put it back in the gateStatsBatch

      // TODO: get the url for this request
      return request.post("upload-stats-endpoint")
        .set('Api-Key', this.apiKey)
        .timeout(this.timeout)
        .send(payload)
    }

    // TODO: remove this fake one. The entire function body can be replaced with the new one after
    var getFakeUploadStatsPromise = () => {
      var payload = this.gateStatsBatch
      this.gateStatsBatch = []
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          console.log('Airship: uploaded stats ', payload)
          resolve();
        }, 500)
      })
    }

    return getFakeUploadStatsPromise();
  }

  _uploadStatsAsync(gateStats) {
    this.gateStatsBatch.push(gateStats);
    if (this.gateStatsUploadBatchInterval === 0) {
      setImmediate(this.triggerUploadStats)
      return
    }

    if (this.gateStatsBatch.length >= this.maxGateStatsBatchSize) {
      setImmediate(this.triggerUploadStats)
      // recreate the setInterval Timeout
      clearInterval(this.gateStatsUploadTimeout)
      this.gateStatsUploadTimeout = setInterval(this.triggerUploadStats, this.gateStatsUploadBatchInterval);
    }
  }

  _endpoint(objects, controlShortName) {
    const payload = {
      env_key: this.envKey
    };

    if (controlShortName) {
      payload.control_short_name = controlShortName;
    }

    if (Array.isArray(objects)) {
      payload.objects = objects.map(this.transformer);
    } else {
      payload.object = this.transformer(objects);
    }

    const url = controlShortName
      ? "https://api.airshiphq.com/v1/gate"
      : "https://api.airshiphq.com/v1/identify";

    return request
      .post(url)
      .type("application/json")
      .set("Api-Key", this.apiKey)
      .timeout(this.timeout)
      .send(payload);
  }

  _processEndpoint(controlShortName, objects, processObjectResponse) {
    return this._endpoint(objects, controlShortName).then(response => {
      if (Array.isArray(response.body)) {
        return response.body.map((objectResponse, index) => [
          objects[index],
          processObjectResponse(objectResponse)
        ]);
      } else {
        return processObjectResponse(response.body);
      }
    });
  }

  isEnabled(controlShortName, object) {
    // TODO: consider triggering another gatingInfo request if gatingInfo are not present, but we need to be
    // careful with this.
    if (this.gatingInfo == null) {
      return false
    }

    // TODO: remove test logging
    console.log('current gatingInfo', this.gatingInfo)

    // TODO: implement the line below
    const gateStats = Date.now() // TODO: remember to serialize in case objects change
    this._uploadStatsAsync(gateStats)
  }

  getVariation(controlShortName, objects) {
    // TODO: consider triggering another gatingInfo request if gatingInfo are not present, but we need to be
    // careful with this.
    if (this.gatingInfo == null) {
      return null
    }

    // TODO: implement the line below
    const gateStats = Date.now() // TODO: remember to serialize in case objects change
    this._uploadStatsAsync(gateStats)
  }

  isEnabledAsync(controlShortName, objects) {
    return this._processEndpoint(
      controlShortName,
      objects,
      o => o.control.value
    );
  }

  getVariationAsync(controlShortName, objects) {
    return this._processEndpoint(
      controlShortName,
      objects,
      o => o.control.variation
    );
  }

  uploadObjects(objects) {
    return this._endpoint(objects);
  }
}
