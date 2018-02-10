import request from "superagent";

export default class Airship {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.environment = options.environment;
    this.timeout = options.timeout || 1000;
    this.transformer = options.transformer || (x => x);
  }

  _endpoint(objects, controlShortName) {
    const payload = {
      env_key: this.environment
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

  isEnabled(controlShortName, objects) {
    return this._processEndpoint(
      controlShortName,
      objects,
      o => o.control.value
    );
  }

  getVariation(controlShortName, objects) {
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
