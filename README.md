# drachtio-conf-tester [![Build Status](https://secure.travis-ci.org/davehorton/drachtio-conf-tester.png)]

A call test generator application, initially developed to load test a conference bridge.

This application requires a drachtio server and a freeswitch server that has either been built using [ansible-role-fsmrf](https://github.com/davehorton/ansible-role-fsmrf), or configured similarly.  A docker image for a configured freeswitch server is available [here](https://hub.docker.com/r/drachtio/drachtio-freeswitch-mrf/) and can be installed by running `docker pull drachtio/drachtio-freeswitch-mrf:latest`

### Running
Create a configuration file at `config/local.json` (review, copy, and edit `config\default.json.example` as necessary), then run `npm start`.

### Configuration
The configuration file contains information about the location of the drachtio and freeswitch servers, as well as call variables that govern the scenario.  Those variables are described below:

```js
  "callflow": {
    "did": "+18005551212", //called party number
    "sbc": "sipp-uas",     //destination ip addess/DNS
    "calls": {
      "total": 10,         // stop after total calls
      "rate": 2,           // calls per second
      "limit": 5           // throttle calls in progress to this
    },
    "initial-delay": 2,    // delay (secs) before first call
    "pin": "1223456",      // enter this pin after connecting
    "pin-entry-delay": 2,  // delay (secs) after connecting before pin
    "call-duration": 20    // hang up call after secs
  }
```
