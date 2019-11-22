#!/usr/bin/env node
const _ = require('lodash');
const moment = require('moment');
const debug = require('debug')('bin:parse2');
const nconf = require('nconf');
const JSDOM = require('jsdom').JSDOM;
const querystring = require('querystring');

const amzproduct = require('../parsers/product')
const amzsearch = require('../parsers/search')
const automo = require('../lib/automo')
const downloader = require('../parsers/downloader');

nconf.argv().env().file({ file: 'config/settings.json' });

/* const echoes = require('../lib/echoes');
echoes.addEcho("elasticsearch");
echoes.setDefaultEcho("elasticsearch"); */

const FREQUENCY = _.parseInt(nconf.get('frequency')) ? _.parseInt(nconf.get('frequency')) : 10;
const backInTime = _.parseInt(nconf.get('minutesago')) ? _.parseInt(nconf.get('minutesago')) : 10;
const id = nconf.get('id');
let singleUse = !!nconf.get('single');
let nodatacounter = 0;
let lastExecution = moment().subtract(backInTime, 'minutes').toISOString();
let computedFrequency = FREQUENCY;

if(backInTime != 10) {
    const humanized = moment.duration(
        moment().subtract(backInTime, 'minutes') - moment()
    ).humanize();
    console.log(`Considering ${backInTime} minutes (${humanized}), as override the standard 10 minutes ${lastExecution}`);
}

function parseAmazonURL(href) {
    const chunks = href.split('/');
    const fragment = querystring.parse(_.last(chunks));

    if(_.startsWith(chunks[3],'s?k')) {
        return {
            href,
            type: 'search',
            query: fragment['s?k']
        };
    } else if(_.size(chunks) === 3) {
        return {
            type: 'home',
            href,
        };
    } else {
        return {
            type: 'product',
            href,
        }
    }

}

async function newLoop() {
    let repeat = !!nconf.get('repeat');
    let htmlFilter = {
        savingTime: {
            $gt: new Date(lastExecution)
        },
    };
    htmlFilter.processed = { $exists: repeat };

    if(id) {
        debug("Targeting a specific metadataId imply --single");
        htmlFilter = {
            metadataId: id
        }
        singleUse = true;
    }

    const htmls = await automo.getLastHTMLs(htmlFilter);
    if(!_.size(htmls.content)) {
        nodatacounter++;
        if( (nodatacounter % 10) == 1) {
            debug("%d no data at the last query: %j",
                nodatacounter, htmlFilter);
        }
        lastExecution = moment().subtract(2, 'm').toISOString();
        computedFrequency = FREQUENCY;
        return;
    } else {
        computedFrequency = 0.5;
    }

    if(!htmls.overflow) {
        lastExecution = moment().subtract(2, 'm').toISOString();
        debug("[%s] Matching objects %d, overflow %s",
            moment.duration(htmls.content[0].savingTime).humanize(),
            _.size(htmls.content), htmls.overflow);
    }
    else {
        lastExecution = moment(_.last(htmls.content).savingTime);
        debug("OVERFLOW: first %s last %s - lastExecution %s", 
            _.first(htmls.content).savingTime, _.last(htmls.content).savingTime,
            lastExecution);
    }

    const analysis = _.map(htmls.content, function(e) { 
        const envelop = {
            impression: e,
            jsdom: new JSDOM(e.html.replace(/\n\ +/g, ''))
                    .window.document,
        }
      
        let metadata = null;
        try {
            debug("%s [%s] %s %d.%d %s %s",
                e.id.substr(0, 4),
                moment(e.savingTime).format("HH:mm:ss"),
                e.metadataId.substr(0, 6),
                e.packet, e.incremental,
                e.size, e.selector);

            const urlInfo = parseAmazonURL(e.href);

            if(urlInfo.type == 'product') {
                metadata = amzproduct.product(envelop);

                if(metadata && _.size(metadata.sections) == 0)
                    debug("Missing related content in evidence %s", e.id);

            } else if(urlInfo.type == 'search') {

                metadata = amzsearch.search(envelop);
                if(metadata && _.size(metadata) == 0)
                    debug("Missing search results in evidence %s", e.id);
            }
            else {
                console.log("URL not supported!", e.href);
                return null;
            }

            if(!metadata) {
                debug("! failure in extraction");
                return null;
            }

            metadata = _.merge(metadata, urlInfo)

        } catch(error) {
            debug("Error in video processing: %s (%s)", error, e.selector);
            return null;
        }

        return [ envelop.impression, metadata ];
    });


    let downloads = 0;
    for (const entry of _.compact(analysis)) {
        if(entry.type == 'product')
            downloads += await downloader.update(entry);
    }
    debug("performed %d downloads", downloads);

    for (const entry of _.compact(analysis)) {
        await automo.updateMetadata(entry[0], entry[1]);
    }

    /* reset no-data-counter if data has been sucessfully processed */
    if(_.size(_.compact(analysis)))
        nodatacounter = 0;

    /* also the HTML cutted off the pipeline, the many skipped 
     * by _.compact all the null in the lists, should be marked as processed */
    const remaining = _.reduce(_.compact(analysis), function(memo, blob) {
        return _.reject(memo, { id: blob[0].id });
    }, htmls.content);

    debug("Usable HTMLs %d/%d - marking as processed the useless %d HTMLs", 
        _.size(_.compact(analysis)), _.size(htmls.content), _.size(remaining));

    for (const html in remaining) {
        await automo.updateMetadata(html, null);
    }
}

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    })
}

async function wrapperLoop() {
    while(true) {
        await newLoop();
        if(singleUse) {
            console.log("Single execution done!")
            process.exit(0);
        }
        await sleep(computedFrequency * 1000)
    }
}

try {
    wrapperLoop();
} catch(e) {
    console.log("Error in newLoop", e.message);
}
