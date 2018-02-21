# airship-nodejs

## Installation
`npm install airship-nodejs`


## Usage
```javascript
import Airship from "airship-nodejs"

// Create an instance with api_key and env_key
let airship = new Airship({api_key: <api_key>, env_key: <env_key>})

// e.g.,
// let airship = new Airship({apiKey: "r9b72kqdh1wbzkpkf7gntwfapqoc26bl", envKey: "nxmqp35umrd3djth"})

// Initialize the instance, returns a Promise.
airship.init()

// Define your object
object = {
  type: "User", // "type" starts with a capital letter "[U]ser", "[H]ome", "[C]ar"
  id: "1234", // "id" must be a string, so if you wish to pass an integer, simply convert via .toString()
  displayName: "ironman@stark.com" // must also be a string
}

airship.isEnabled("bitcoin-pay", object)
airship.getVariation("bitcoin-pay", object) // For multi-variate flags
airship.isEligible("bitcoin-pay", object)
// Returns true if the object can potentially receive the feature via sampling
// or is already receiving the feature.
```


## Attributes (for complex targeting)
```javascript
// Define your object with an attributes dictionary of key-value pairs.
// Values must be a string, a number, or a boolean. nil values are not accepted.
// For date or datetime string value, use iso8601 format.
object = {
  type: "User",
  id: "1234",
  displayName: "ironman@stark.com",
  attributes: {
    t_shirt_size: "M",
    date_created: "2018-02-18",
    time_converted: "2018-02-20T21:54:00.630815+00:00",
    owns_property: true,
    age: 39
  }
}

// Now in app.airshiphq.com, you can target this particular user using its
// attributes
```

## Group (for membership-like cascading behavior)
```javascript
// An object can be a member of a group.
// The structure of a group object is just like that of the base object.
object = {
  type: "User",
  id: "1234",
  displayName: "ironman@stark.com",
  attributes: {
    t_shirt_size: "M",
    date_created: "2018-02-18",
    time_converted: "2018-02-20T21:54:00.630815+00:00",
    owns_property: true,
    age: 39
  },
  group: {
    type: "Club",
    id: "5678",
    displayName: "SF Homeowners Club",
    attributes: {
      founded: "2016-01-01",
      active: true
    }
  }
}

// Inheritance of values `isEnabled`, `getVariation`, and `isEligible` works as follows:
// 1. If the group is enabled, but the base object is not,
//    then the base object will inherit the values `isEnabled`, `getVariation`, and
//    `isEligible` of the group object.
// 2. If the base object is explicitly blacklisted, then it will not inherit.
// 3. If the base object is not given a variation in rule-based variation assignment,
//    but the group is and both are enabled, then the base object will inherit
//    the variation of the group's.


// You can ask questions about the group directly (use the `isGroup` flag):
object = {
  isGroup: true,
  type: "Club",
  id: "5678",
  displayName: "SF Homeowners Club",
  attributes: {
    founded: "2016-01-01",
    active: true
  }
}

airship.isEnabled("bitcoin-pay", object)
```
