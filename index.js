import request from 'superagent'

const SERVER_URL = 'https://api.airshiphq.com'
const GATE_ENDPOINT = `${SERVER_URL}/v1/gate`
const GATING_INFO_ENDPOINT = `${SERVER_URL}/v1/gating-info`

class Airship {
  constructor(options, cb) {
    this.apiKey = options.apiKey
    this.envKey = options.envKey
    this.timeout = options.timeout || 10000
    this.transformer = options.transformer || (x => x)

    // This is passed a reason.
    this.gatingInfoErrorCb = options.gatingInfoErrorCb || (() => console.error('Airship: failed to retrieve gating info.'))
    this.gatingInfo = null
    // Used to check whether we are already trying to get gatingInfo.
    this.gatingInfoPromise = null
    this.gatingInfoMap = null

    let hardMaxGateStatsBatchSize = 500
    this.maxGateStatsBatchSize = options.maxGateStatsBatchSize !== undefined // Allow 0 for no batching
      ? Math.min(Math.max(options.maxGateStatsBatchSize, 0), hardMaxGateStatsBatchSize) : hardMaxGateStatsBatchSize
    this.gateStatsUploadBatchInterval = options.gateStatsUploadBatchInterval !== undefined // Allow 0 for BatchInterval -> immediate
      ? Math.max(options.gateStatsUploadBatchInterval, 0) : 5000 // in milliseconds
    // This is the timer from setInterval for uploading stats. This timer is cleared and recreated
    // when the batch size is reached, ensuring that stats upload requests are always triggered
    // within options.gateStatsUploadBatchInterval seconds of the event.
    // More than one upload stats requests can simultaneously be in flight (unlike rules)
    this.gateStatsUploadTimeout = null
    this.gateStatsBatch = []
  }

  // If this is passed a callback as an argument, the arguments null, true will be passed on success,
  // or an Error will be passed on failure.
  // If this is not passed a callback as an argument, this will return a Promise that resolves when
  // initialization is complete.
  init = (cb) => {
    if (this.gateStatsUploadBatchInterval > 0) {
      this.gateStatsUploadTimeout = setInterval(this.triggerUploadStats, this.gateStatsUploadBatchInterval)
    }

    let getGatingInfoPromise = () => {
      return request.get(`${GATING_INFO_ENDPOINT}/${this.envKey}`)
        .set('api-key', this.apiKey)
        .timeout(this.timeout)
    }

    // TODO: remove this fake one
    let getFakeGatingInfoPromise = () => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let gatingInfo = {
            timestamp: Date.now()
          }
          console.log('Airship: retrieved gatingInfo', gatingInfo)
          resolve(gatingInfo)
        }, 500)
      })
    }

    let maybeGetGatingInfoPromise = () => {
      if (this.gatingInfoPromise) {
        return
      }

      this.gatingInfoPromise = getGatingInfoPromise().then(res => {
        let gatingInfo = res.body

        if (gatingInfo.serverInfo === 'maintenance') {
          this.gatingInfoPromise = null
        } else {
          let gatingInfoMap = this._getGatingInfoMap(gatingInfo)

          this.gatingInfo = gatingInfo
          this.gatingInfoMap = gatingInfoMap
          this.gatingInfoPromise = null
        }
      }).catch(err => {
        this.gatingInfoPromise = null
        this.gatingInfoErrorCb(err)
        throw err // TODO: important, need to catch inside the setInterval
      })
      return this.gatingInfoPromise
    }

    let initialGatingInfoPromise = maybeGetGatingInfoPromise()
    setInterval(() => {
      maybeGetGatingInfoPromise().catch(reason => {
        // Catch the error, but ignore or notify.
      })
    }, 5 * 60 * 1000)

    if (cb) {
      initialGatingInfoPromise
        .then(() => cb(null, true))
        .catch(() => cb(new Error('Airship: failed to initialize, will re-try in five (5) minutes.')))
      return
    }

    return initialGatingInfoPromise
  }

  // TODO: fix babel to triggerUploadStats = () => {
  triggerUploadStats = () => {
    if (!this.gateStatsBatch.length) {
      return
    }

    let getUploadStatsPromise = () => {
      let payload = this.gateStatsBatch
      this.gateStatsBatch = []

      // TODO: error handling on triggerUploadStats - do we try again?
      // not right now, but we could add .then() referring to `payload` to put it back in the gateStatsBatch

      // TODO: get the url for this request
      return request.post('upload-stats-endpoint')
        .set('api-key', this.apiKey)
        .timeout(this.timeout)
        .send(payload)
    }

    // TODO: remove this fake one. The entire function body can be replaced with the new one after
    let getFakeUploadStatsPromise = () => {
      let payload = this.gateStatsBatch
      this.gateStatsBatch = []
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          console.log('Airship: uploaded stats ', payload)
          resolve()
        }, 500)
      })
    }

    return getFakeUploadStatsPromise()
  }

  _getGatingInfoMap = (gatingInfo) => {
    let map = {}

    let controls = gatingInfo.controls

    for (let i = 0; i < controls.length; i++) {
      let control = controls[i]
      let controlInfo = {}

      controlInfo['is_on'] = control.is_on
      controlInfo['rule_based_distribution_default_variation'] = control.rule_based_distribution_default_variation
      controlInfo['rule_sets'] = control.rule_sets
      controlInfo['distributions'] = control.distributions

      let enablements = control.enablements
      let enablementInfo = {}

      for (let j = 0; j < enablements.length; j++) {
        let enablement = enablements[j]

        let clientIdentitiesMap = enablementInfo[enablement.client_object_type_name]

        if (clientIdentitiesMap === undefined) {
          enablementInfo[enablement.client_object_type_name] = {}
        }

        enablementInfo[enablement.client_object_type_name][enablement.client_object_identity] = [enablement.is_enabled, enablement.variation]
      }

      controlInfo['enablements'] = enablementInfo

      map[control.short_name] = controlInfo
    }

    return map
  }

  _uploadStatsAsync = (gateStats) => {
    this.gateStatsBatch.push(gateStats)
    if (this.gateStatsUploadBatchInterval === 0) {
      setImmediate(this.triggerUploadStats)
      return
    }

    if (this.gateStatsBatch.length >= this.maxGateStatsBatchSize) {
      setImmediate(this.triggerUploadStats)
      // recreate the setInterval Timeout
      clearInterval(this.gateStatsUploadTimeout)
      this.gateStatsUploadTimeout = setInterval(this.triggerUploadStats, this.gateStatsUploadBatchInterval)
    }
  }

  _endpoint = (objects, controlShortName) => {
    const payload = {
      env_key: this.envKey
    }

    if (controlShortName) {
      payload.control_short_name = controlShortName
    }

    if (Array.isArray(objects)) {
      payload.objects = objects.map(this.transformer)
    } else {
      payload.object = this.transformer(objects)
    }

    const url = controlShortName
      ? 'https://api.airshiphq.com/v1/gate'
      : 'https://api.airshiphq.com/v1/identify'

    return request
      .post(url)
      .type('application/json')
      .set('api-key', this.apiKey)
      .timeout(this.timeout)
      .send(payload)
  }

  _processEndpoint = (controlShortName, objects, processObjectResponse) => {
    return this._endpoint(objects, controlShortName).then(response => {
      if (Array.isArray(response.body)) {
        return response.body.map((objectResponse, index) => [
          objects[index],
          processObjectResponse(objectResponse)
        ])
      } else {
        return processObjectResponse(response.body)
      }
    })
  }

  isEnabled = (controlShortName, object) => {
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

  getVariation = (controlShortName, objects) => {
    // TODO: consider triggering another gatingInfo request if gatingInfo are not present, but we need to be
    // careful with this.
    if (this.gatingInfo == null) {
      return null
    }

    // TODO: implement the line below
    const gateStats = Date.now() // TODO: remember to serialize in case objects change
    this._uploadStatsAsync(gateStats)
  }

  isEnabledAsync = (controlShortName, objects) => {
    return this._processEndpoint(
      controlShortName,
      objects,
      o => o.control.value
    )
  }

  getVariationAsync = (controlShortName, objects) => {
    return this._processEndpoint(
      controlShortName,
      objects,
      o => o.control.variation
    )
  }

  uploadObjects = (objects) => {
    return this._endpoint(objects)
  }
}

exports = module.exports = Airship
