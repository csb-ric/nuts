var _ = require('lodash');
var Q = require('q');
var path = require('path');
var os = require('os');
var destroy = require('destroy');
var LRU = require('lru-diskcache');
var fs = require('fs-extra');
var streamRes = require('stream-res');
var Buffer = require('buffer').Buffer;

LRU.prototype.reset = function() {
    var that = this;

    this.lru.reset();

    if (!fs.existsSync(this.path)) {
        fs.mkdirsSync(this.path);
    } else {
        fs.readdirSync(this.path).forEach(function(file) {
            console.log(file);
            that.lru.set(file);
        });
    }
};

LRU.prototype.has = function(key) {
    if (this.lru.has(key)) {
        return true;
    } else if (fs.existsSync(this._filename(key)) && fs.statSync(this._filename(key)).size > 1) {
        this.lru.set(key, true);
        return true;
    }
    return false;
};

function Backend(nuts, opts) {
    this.cacheId = 0;
    this.nuts = nuts;
    this.opts = _.defaults(opts || {}, {
        // Folder to cache assets
        cache: path.resolve(os.tmpdir(), 'nuts'),

        // Cache configuration
        cacheMax: 500 * 1024 * 1024,
        cacheMaxAge: 365 * 24 * 60 * 60 * 1000,
    });

    console.log("Cache options: ", opts.cache, {
        max: opts.cacheMax,
        maxAge: opts.cacheMaxAge
    });

    // Create cache
    this.cache = LRU(opts.cache, {
        max: opts.cacheMax,
        maxAge: opts.cacheMaxAge
    });

    _.bindAll(this);
}

// Memoize a function
Backend.prototype.memoize = function(fn) {
    var that = this;

    return _.memoize(fn, function() {
        return that.cacheId+Math.ceil(Date.now()/that.opts.cacheMaxAge)
    });
};

// New release? clear cache
Backend.prototype.onRelease = function() {
    this.cacheId++;
};

// Initialize the backend
Backend.prototype.init = function() {
    this.cache.init();
    return Q();
};

// List all releases for this repository
Backend.prototype.releases = function() {

};

// Return stream for an asset
Backend.prototype.serveAsset = function(asset, req, res) {
    var that = this;
    var cacheKey = asset.id;

    function outputStream(stream) {
        var d = Q.defer();
        streamRes(res, stream, d.makeNodeResolver());
        return d.promise;
    }

    res.header('Content-Length', asset.size);
    res.attachment(asset.filename);

    // Key exists
    console.log("Cache Key: ", cacheKey);
    if (that.cache.has(cacheKey)) {
        return that.cache.getStream(cacheKey)
            .then(outputStream);
    }

    return that.getAssetStream(asset)
    .then(function(stream) {
        console.log("Got stream...");
        return Q.all([
            // Cache the stream
            that.cache.set(cacheKey, stream),

            // Send the stream to the user
            outputStream(stream)
        ]);
    });
};

// Return stream for an asset
Backend.prototype.getAssetStream = function(asset) {

};

// Return stream for an asset
Backend.prototype.readAsset = function(asset) {
    return this.getAssetStream(asset)
    .then(function(res) {
        var d = Q.defer();
        var output = Buffer([]);

        function cleanup() {
            destroy(res);
            res.removeAllListeners();
        }

        res.on('data', function(buf) {
                output = Buffer.concat([output, buf]);
            })
            .on('error', function(err) {
                cleanup();
                d.reject(err);
            })
            .on('end', function() {
                cleanup();
                d.resolve(output);
            });

        return d.promise

    })
};

module.exports = Backend;
