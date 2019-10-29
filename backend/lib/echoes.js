// debugger module, suggested song: echoes pink floyd
const _ = require('lodash');
const debug = require('debug')('lib:echoes');
const Reflect = require("harmony-reflect");
const nconf = require('nconf');
const Promise = require('bluebird');

const elasticsearchClient = require("./elasticsearch")
const utils = require('./utils');

const DISABLESTR = "disabled";
const FBTREX_ENV_DEFAULT = "development";

function Echoes(configuration){
    this.configuration = configuration
    this.debuggers = {}
    this.defaultEcho = null;
}

function isDisabled() {
    return (nconf.get('elastic') == DISABLESTR);
}

Echoes.prototype.getEchoClient = function(client){
    return {"elasticsearch": elasticsearchClient}[client];
}
Echoes.prototype.addEcho = function(echoClient){
    if(isDisabled()) return null;
    var clientConf = this.configuration[echoClient]
    var client =  this.getEchoClient(echoClient)
    try {
        this.debuggers[echoClient] = Reflect.construct(client, [clientConf])
    } catch(error) {
        debug("Error managed in addEcho [ elastic=%s can turn it off ]", DISABLESTR);
        debug(error);
    }
    return client
}
Echoes.prototype.setDefaultEcho = function(echo){
    this.defaultEcho = this.debuggers[echo]
    return this.defaultEcho
}
Echoes.prototype.echo = function(data){
    if(isDisabled()) return null;

    if(this.defaultEcho == null)
        return null;
    
    /* for each log entry, is computed an unique ID and the date time `when` is addedd too */
    data.when = new Date();
    data._id = _.toString(Date.now()).substring(2, 13) + _.random(1000, 9999);
    data.index = data.index+"."+(nconf.get('FBTREX_ENV')||FBTREX_ENV_DEFAULT);
    /* remind: considering this is stripping the first two digits of the epoch, 
     * should be verify if this might lead to future collisions */
    debug("sending id %d to index [%s]", data.id, data.index);
    
    var defaultEcho = this.defaultEcho;
    new Promise(function(afterAction) {
        var result = defaultEcho.sendDebug(data);
        if(afterAction != null)
            afterAction(result);
    })
    .catch(function(error) {
        debug(error);
        debug("Error catch [ use elastic=%s to turn it off ]", DISABLESTR);
    });
}

Echoes.prototype.enabled = function() {
    return !isDisabled();
};

module.exports = new Echoes({
    elasticsearch: { 
        hosts : [ nconf.get("elastic") ]
    },
});
