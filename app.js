const config = require('config');
const Srf = require('drachtio-srf');
const srf = new Srf();
const Mrf = require('drachtio-fsmrf');
const async = require('async');
const logger = require('pino')();
//const debug = require('debug')('drachtio:conf-tester');

srf.connect(config.get('drachtio'));
if (process.env.NODE_ENV !== 'test') {
  srf.on('error', (err) => {
    logger.info(`error connecting to drachtio: ${err}`);
  });
}
srf.on('connect', onSrfConnected);

function onSrfConnected(err, hp) {
  logger.info(`connected to drachtio: ${hp}`);
  const mrf = new Mrf(srf);
  mrf.connect(config.get('freeswitch'), (err, mediaserver) => {
    if (err) return logger.error(`error connecting to media server: ${err}`);
    const delay = config.get('callflow.initial-delay');
    logger.info(`connected to media server, waiting ${delay}s..`);
    setTimeout(runScenario.bind(null, mediaserver), delay * 1000);
  });
}

let intervalID;
const callsInProgress = new Map();
let countSuccess = 0;
let countFailure = 0;
let countStarting = 0;
let checks = 0;
let reachTotal = false;
let throttling = false;
const conferenceUri = `sip:${config.get('callflow.did')}@${config.get('callflow.sbc')}`;
process
  .on('SIGINT', () => {  logger.warn('SIGINT received.. shutting down..'); do_shutdown(); });

function runScenario(mediaserver) {
  const total = config.get('callflow.calls.total');
  const limit = config.get('callflow.calls.limit');
  const rate = config.get('callflow.calls.rate');

  logger.info(`starting ${rate} calls/sec, total ${total} limiting to ${limit} simultaneous calls`);

  intervalID = setInterval(checkCalls.bind(null, mediaserver, total, limit, rate), 1000);
}

function checkCalls(mediaserver, total, limit, rate) {
  const countFinished = countSuccess + countFailure;
  const currentCalls = callsInProgress.size;
  const idx = ++checks;

  if (idx % 10 === 0) {
    logger.info(`${countSuccess}/${countFailure}/${currentCalls} - success/failure/in progress`);
  }

  if (countFinished >= total) {
    logger.info(`checkCalls: shutting down because total desired calls have been completed: ${countFinished}`);
    return do_shutdown();
  }

  if (currentCalls + countFinished + countStarting >= total) {
    if (!reachTotal || !(idx % 60)) {
      logger.info(`checkCalls: not starting any calls because we have reached our total: ${total}`);
    }
    reachTotal = true;
    return;
  }
  else if (currentCalls >= limit) {
    if (!throttling) {
      logger.info(`checkCalls: not starting any calls because we have reached our limit: ${limit}`);
      throttling = true;
    }
    return;
  }

  logger.debug(`total: ${total}, in progress: ${currentCalls}, finished: ${countFinished}, starting: ${countStarting}`);

  // start 'rate' calls evenly spread out over the next second
  let countStart = Math.min(rate, total - countFinished - currentCalls);
  const msInterval = Math.floor(1000 / countStart);
  countStarting += countStart;
  logger.debug(`checkCalls: starting ${countStart} calls with ${msInterval}ms delay`);

  async.doUntil((callback) => {
    setTimeout(() => {
      countStart--;
      launchCall(mediaserver)
        .then((obj) => {
          countStarting--;
          playIvr(obj.ep);
          logger.debug(`call started successfully: ${obj.dlg.sip.callId}`);
          return callback.bind(null)();
        })
        .catch((err) => {
          logger.error(err, `checkCalls: failed to create call: ${err}`);
          countStarting--;
          countFailure++;
        });
    }, msInterval);
  }, () => countStart === 0);
}

let callNo = 0;
function launchCall(mediaserver) {
  let ep;
  return mediaserver.createEndpoint()
    .then((endpoint) => {
      ep = endpoint;
      return srf.createUAC(conferenceUri, {
        localSdp: ep.local.sdp,
        callingNumber: `call-${++callNo}`
      });
    })
    .then((dlg) => {
      const obj = {dlg, ep};
      ep.modify(dlg.remote.sdp);
      setDialogHandlers(obj);
      return obj;
    });
}

function playIvr(ep) {
  setTimeout(() => {
    const pin = config.get('callflow.pin');
    logger.debug(`playing pin ${pin}`);
    return ep.execute('send_dtmf', pin)
      .then((results) => {
        return ep.execute('playback', 'silence_stream://-1,1400');
      })
      .catch((err) => {
        logger.error(err, 'Error playing pin');
      });
  }, config.get('callflow.pin-entry-delay') * 1000);
}

function setDialogHandlers(obj) {
  const {dlg, ep} = obj;
  const callId = dlg.sip.callId;

  dlg
    .on('destroy', () => {
      logger.warn(`${callId}: got unexpected BYE`);
      const saved = callsInProgress.get(callId);
      if (saved) {
        callsInProgress.delete(callId);
        countFailure++;
        clearTimeout(saved.timerID);
      }
    })
    .on('modify', (req, res) => {
      logger.info(`${callId}: got re-INVITE`);
      res.send(200, { body: ep.local.sdp });
    })
    .on('refresh', (req) => {
      logger.info(`${callId}: got refreshing reINVITE`);
    });

  const timerID = setTimeout(() => {
    logger.debug(`hanging up call ${callId}`);
    dlg.destroy();
    ep.destroy();
    callsInProgress.delete(callId);
    countSuccess++;
  }, config.get('callflow.call-duration') * 1000);

  callsInProgress.set(dlg.sip.callId, Object.assign(obj, {timerID}));
}

function do_shutdown() {
  if (intervalID) clearInterval(intervalID);

  if (callsInProgress.size) logger.info(`do_shutdown: killing ${callsInProgress.size} calls in progress`);

  for (const item of callsInProgress) {
    const {dlg, ep} = item[1];
    countSuccess++;
    ep.destroy();
    dlg.destroy();
  }

  logger.info(`final stats: ${countSuccess} success, ${countFailure} failure`);
  if (process.env.NODE_ENV === 'test') {
    srf.emit('test.complete', countSuccess, countFailure);
  }
  else {
    setTimeout(() => {process.exit(0);}, 1000);
  }
}

module.exports = {srf};
