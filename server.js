var redis = require('redis').createClient();
var liveDbMongo = require('livedb-mongo');
var racerBrowserChannel = require('racer-browserchannel');
var compression = require('compression')
var markdown = require('markdown').markdown;

var fs = require('fs');
var http = require('http');
var express = require('express');
var handlebars = require('handlebars');
var racer = require('racer');
racer.use(require('racer-bundle'));


var options = {
  redis_db: process.env.REDIS_DB || 14,
  mongo_string: process.env.MONGO_STRING || 'localhost:27017/wiki?auto_reconnect',
  port: process.env.PORT || 3000
}
redis.select(options.redis_db);
var store = racer.createStore({
  //db: liveDbMongo(options.mongo_string, {safe: true})
  db: liveDbMongo( 'localhost:27017/wiki?auto_reconnect', {safe: true})
, redis: redis
});

app = express();
app
  .use(express.favicon())
  .use(compression())
  .use(racerBrowserChannel(store))
  .use(store.modelMiddleware())
  .use(app.router)
  .use('/assets',express.static(__dirname + "/assets"))

app.use(function(err, req, res, next) {
  console.error(err.stack || (new Error(err)).stack);
  res.send(500, 'Something broke!');
});

function scriptBundle(cb) {
  // Use Browserify to generate a script file containing all of the client-side
  // scripts, Racer, and BrowserChannel
  store.bundle(__dirname + '/client.js', function(err, js) {
    if (err) return cb(err);
    cb(null, js);
  });
}
// Immediately cache the result of the bundling in production mode, which is
// deteremined by the NODE_ENV environment variable. In development, the bundle
// will be recreated on every page refresh
if (racer.util.isProduction) {
  scriptBundle(function(err, js) {
    if (err) return;
    scriptBundle = function(cb) {
      cb(null, js);
    };
  });
}

app.get('/script.js', function(req, res, next) {
  scriptBundle(function(err, js) {
    if (err) return next(err);
    res.type('js');
    res.send(js);
  });
});

function validateRoomId(roomId,next){
  if (!/^[a-zA-Z0-9_-]+$/.test(roomId)) return next();
}

var showTemplate = fs.readFileSync(__dirname + '/views/show.handlebars', 'utf-8');
var showPage = handlebars.compile(showTemplate);

app.get('/:roomId', function(req, res, next) {
  var model = req.getModel({fetchOnly: true});
  res.setHeader('Cache-Control', 'no-store');
  validateRoomId(req.params.roomId, next);
  var roomPath = 'rooms.' + req.params.roomId;

  // actually doesn't suscribe because of the fetchOnly option
  model.subscribe(roomPath, function(err) {
    if (err) return next(err);

    model.ref('_page.room', roomPath);
    model.bundle(function(err, bundle) {
      if (err) return next(err);
      var html = showPage({
        room: req.params.roomId
      , text: markdown.toHTML(model.get(roomPath))
      });
      res.send(html);
    });
  });
});
var editTemplate = fs.readFileSync(__dirname + '/views/edit.handlebars', 'utf-8');
var editPage = handlebars.compile(editTemplate);

app.get('/:roomId/edit', function(req, res, next) {
  var model = req.getModel();
  // Only handle URLs that use alphanumberic characters, underscores, and dashes
  // Prevent the browser from storing the HTML response in its back cache, since
  // that will cause it to render with the data from the initial load first
  res.setHeader('Cache-Control', 'no-store');
  validateRoomId(req.params.roomId, next);

  var roomPath = 'rooms.' + req.params.roomId;
  model.subscribe(roomPath, function(err) {
    if (err) return next(err);

    model.ref('_page.room', roomPath);
    model.bundle(function(err, bundle) {
      if (err) return next(err);
      var html = editPage({
        room: req.params.roomId
      , text: model.get(roomPath)
        // Escape bundle for use in an HTML attribute in single quotes, since
        // JSON will have lots of double quotes
      , bundle: JSON.stringify(bundle).replace(/'/g, '&#39;')
      });
      res.send(html);
    });
  });
});

app.get('/', function(req, res) {
  res.redirect('/home');
});

http.createServer(app).listen(options.port, function() {
  console.log('Go to http://localhost:' + options.port);
});

