const _ = require('lodash');
const moment = require('moment');
const debug = require('debug')('routes:personal');

const automo = require('../lib/automo');
const params = require('../lib/params');
const CSV = require('../lib/CSV');

async function getPersonal(req) {
    const DEFMAX = 40;
    const k =  req.params.publicKey;
    if(_.size(k) < 26)
        return { json: { "message": "Invalid publicKey", "error": true }};

    const { amount, skip } = params.optionParsing(req.params.paging, DEFMAX);
    debug("getPersonal: amount %d skip %d, default max %d", amount, skip, DEFMAX);

    const data = await automo.getSummaryByPublicKey(k, { amount, skip });
    data.request = {
        amount,
        skip,
        when: moment().toISOString()
    }
    return { json: data };
};

async function getPersonalCSV(req) {
    const CSV_MAX_SIZE = 1000;
    const k =  req.params.publicKey;

    const data = await automo.getMetadataByPublicKey(k, { amount: CSV_MAX_SIZE, skip: 0 });
    const unwinded = _.reduce(data.metadata, function(memo, evidence) {
        let exprelated = _.map(evidence.sections, function(section, i) {
            return _.map(section.related, function(product, o) {
                return {
                    watchedId: evidence.productId,
                    savingTime: evidence.savingTime,
                    publicKey: evidence.publicKey,
                    section: section.category,
                    productOrder: o,
                    productName: product.name,
                    productId: product.chunks[3],
                    sectionPosition: i + 1,
                    watchedProduct: evidence.productName,
                    footer: evidence.footer,
                };
            });
        });
        memo = _.concat(memo, _.compact(_.flatten(exprelated)));
        return memo;
    }, []);
    debug("data %d -> unwinded %d", _.size(data.metadata), _.size(unwinded));
    const csv = CSV.produceCSVv1(unwinded);

    debug("getPersonalCSV produced %d bytes from %d entries (max %d)",
        _.size(csv), _.size(data), CSV_MAX_SIZE);

    if(!_.size(csv))
        return { text: "Error, Content not available 🤷" };

    const filename = 'your-amtrex-' + moment().format("YY-MM-DD") + ".csv"
    return {
        headers: {
            "Content-Type": "csv/text",
            "Content-Disposition": "attachment; filename=" + filename
        },
        text: csv,
    };
};

async function getPersonalRelated(req) {
    const DEFMAX = 40;
    const k =  req.params.publicKey;
    if(_.size(k) < 26)
        return { json: { "message": "Invalid publicKey", "error": true }};

    const { amount, skip } = params.optionParsing(req.params.paging, DEFMAX);
    debug("getPersonalRelated request by %s using %d starting videos, skip %d (defmax %d)", k, amount, skip, DEFMAX);
    let related = await automo.getRelatedByWatcher(k, { amount, skip });
    const formatted = _.map(related, function(r) {
        /* this is the same format in youtube.tracking.exposed/data,u
         * and should be in lib + documented */
        return {
            id: r.id,
            videoId: r.related.videoId,
            title: r.related.title,
            source: _.replace(r.related.source, /\n/g, ' ⁞ '),
            vizstr: r.related.vizstr,
            suggestionOrder: r.related.index,
            displayLength: r.related.displayTime,
            watched: r.title,
            since: r.publicationString,
            credited: r.authorName,
            channel: r.authorSource,
            savingTime: r.savingTime,
            watcher: r.watcher,
            watchedId: r.videoId,
        };
    });

    debug("getPersonalRelated produced %d results", _.size(formatted));
    return {
        json: formatted
    };
};

async function getEvidences(req) {
    /* this function is quite generic and flexible. allow an user to query their 
     * own evidences and allow specification of which is the field to be queried.
     * It is used in our interface with 'id' */
    const k =  req.params.publicKey;
    if(_.size(k) < 26)
        return { json: { "message": "Invalid publicKey", "error": true }};

    const allowFields = ['tagId', 'id', 'videoId'];
    const targetKey = req.params.key;
    const targetValue = req.params.value;

    if(allowFields.indexOf(targetKey) == -1)
        return { json: { "message": `Key ${targetKey} not allowed (${allowFields})`, error: true }};

    const matches = await automo.getVideosByPublicKey(k, _.set({}, targetKey, targetValue));
    debug("getEvidences with flexible filter found %d matches", _.size(matches));
    return { json: matches };
};

async function removeEvidence(req) {
    const k =  req.params.publicKey;
    if(_.size(k) < 26)
        return { json: { "message": "Invalid publicKey", "error": true }};

    const id = req.params.id;
    const result = await automo.deleteEntry(k, id);
    return { json: { success: true, result }};
};


module.exports = {
    getPersonal,
    getPersonalCSV,
    getPersonalRelated,
    getEvidences,
    removeEvidence,
};
