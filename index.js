import request from 'superagent'
import Ajv from 'ajv'

const SERVER_URL = 'https://api.airshiphq.com'
const GATE_ENDPOINT = `${SERVER_URL}/v1/gate`
const GATING_INFO_ENDPOINT = `${SERVER_URL}/v1/gating-info`

const SCHEMA = {
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "pattern": "^([A-Z][a-zA-Z]*)+$",
      "maxLength": 50,
    },
    "is_group": {
      "type": "boolean",
    },
    "isGroup": {
      "type": "boolean",
    },
    "id": {
      "type": "string",
      "maxLength": 250,
      "minLength": 1,
    },
    "display_name": {
      "type": "string",
      "maxLength": 250,
      "minLength": 1,
    },
    "displayName": {
      "type": "string",
      "maxLength": 250,
      "minLength": 1,
    },
    "attributes": {
      "type": "object",
      "patternProperties": {
        "^[a-zA-Z][a-zA-Z_]{0,48}[a-zA-Z]$": {
          "oneOf": [
            {
              "type": "string",
              "maxLength": 3000,
            },
            {
              "type": "boolean"
            },
            {
              "type": "number"
            },
          ],
        },
      },
      "maxProperties": 100,
      "additionalProperties": false,
    },
    "group": {
      "type": ["object", "null"],
      "properties": {
        "type": {
          "type": "string",
          "pattern": "^([A-Z][a-zA-Z]*)+$",
          "maxLength": 50,
        },
        "is_group": {
          "type": "boolean",
          "enum": [true],
        },
        "isGroup": {
          "type": "boolean",
          "enum": [true],
        },
        "id": {
          "type": "string",
          "maxLength": 250,
          "minLength": 1,
        },
        "display_name": {
          "type": "string",
          "maxLength": 250,
          "minLength": 1,
        },
        "displayName": {
          "type": "string",
          "maxLength": 250,
          "minLength": 1,
        },
        "attributes": {
          "type": "object",
          "patternProperties": {
            "^[a-zA-Z][a-zA-Z_]{0,48}[a-zA-Z]$": {
              "oneOf": [
                {
                  "type": "string",
                  "maxLength": 3000,
                },
                {
                  "type": "boolean"
                },
                {
                  "type": "number"
                },
              ],
            },
          },
          "maxProperties": 100,
          "additionalProperties": false,
        },
      },
      "oneOf": [
        {"required": ["id", "display_name"]},
        {"required": ["id", "displayName"]},
      ],
      "additionalProperties": false,
    },
  },
  "oneOf": [
    {"required": ["type", "id", "display_name"]},
    {"required": ["type", "id", "displayName"]},
  ],
  "additionalProperties": false,
}

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
    let ajv = Ajv()
    this.validate = ajv.compile(SCHEMA)
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
      maybeGetGatingInfoPromise().catch(err => {
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

  triggerUploadStats = () => {
    if (this.gateStatsBatch.length === 0) {
      return
    }

    let getUploadStatsPromise = () => {
      let payload = this.gateStatsBatch
      this.gateStatsBatch = []

      // TODO: error handling on triggerUploadStats - do we try again?
      // not right now, but we could add .then() referring to `payload` to put it back in the gateStatsBatch

      // TODO: get the url for this request
      return request.post('upload-stats-endpoint')
        .type('application/json')
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

  _getGatValues = (controlShortName, object) => {
    if (this.gatingInfoMap[controlShortName] === undefined) {
      return {
        isEnabled: false,
        variation: null,
        isEligible: false,
        _shouldSendStats: false,
      }
    }
  }

  _cloneObject = (object) => {
    let clone = Object.assign({}, object)

    if (object.attributes !== undefined) {
      clone.attributes = Object.assign({}, object.attributes)
    }

    if (object.group !== undefined) {
      clone.group = Object.assign({}, object.group)

      if (object.group.attributes !== undefined) {
        clone.group.attributes = Object.assign({}, object.group.attributes)
      }
    }

    return clone
  }

  _validateCasing = (object) => {
    if (object.display_name !== undefined && object.displayName !== undefined) {
      return 'Please provide either "display_name" or "displayName", but not both'
    }

    if (object.is_group !== undefined && object.isGroup !== undefined) {
      return 'Please provide either "is_group" or "isGroup", but not both'
    }

    if (object.group !== undefined) {
      let group = object.group

      if (group.display_name !== undefined && group.displayName !== undefined) {
        return 'Please provide either "display_name" or "displayName", but not both'
      }

      if (group.is_group !== undefined && group.isGroup !== undefined) {
        return 'Please provide either "is_group" or "isGroup", but not both'
      }
    }

    return null
  }

  isEnabled = (controlShortName, object) => {
    if (this.gatingInfoMap === null) {
      return false
    }

    let valid = this.validate(object)

    if (!valid) {
      console.error(this.validate.errors)
      return false
    }

    object = this._cloneObject(object)

    let error = this._validateCasing(object)

    if (error) {
      console.error(error)
      return false
    }

    let gateTimestamp = (new Date()).toISOString()
  }

  getVariation = (controlShortName, object) => {
    if (this.gatingInfoMap === null) {
      return null
    }

    let valid = this.validate(object)

    if (!valid) {
      console.error(this.validate.errors)
      return null
    }

    object = this._cloneObject(object)

    let error = this._validateCasing(object)

    if (error) {
      console.error(error)
      return null
    }

    let gateTimestamp = (new Date()).toISOString()
  }

  isEligible = (controlShortName, object) => {
    if (this.gatingInfoMap === null) {
      return false
    }

    let valid = this.validate(object)

    if (!valid) {
      console.error(this.validate.errors)
      return false
    }

    object = this._cloneObject(object)

    let error = this._validateCasing(object)

    if (error) {
      console.error(error)
      return false
    }

    let gateTimestamp = (new Date()).toISOString()
  }
}

exports = module.exports = Airship
