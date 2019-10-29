var _ = require('lodash');
var Promise = require('bluebird');
var debug = require('debug')('lib:htmlunit');
var nconf = require('nconf');
var fs = Promise.promisifyAll(require('fs'));

var mongo = require('./mongo');

function unitById(req) {
    var htmlId = req.params.htmlId;

    debug("soon to be discontinued or support v2 htmls - unitById %s", htmlId);

    return mongo
        .read(nconf.get('schema').videos, {id: htmlId})
        .then(_.first)
        .then(function(video) {
            return fs
                .readFileAsync(video.htmlOnDisk, 'utf-8')
                .then(function(html) {
                    return {
                        html: html,
                        metadata: video
                    };
                });
        })
        .then(function(c) {
            return { json: c };
        }); 
}

module.exports = {
    unitById:unitById
};
