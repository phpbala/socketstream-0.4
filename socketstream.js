/*
   
   SocketStream 0.4 (Experimental!)
   --------------------------------
   Keep track of Single Page Clients and allow actions to be performed on them all

*/


var fs = require('fs'),
    path = require('path'),
    EventEmitter = require('events').EventEmitter,
    MuxDemux = require('mux-demux'),
    Clients = require('./lib/clients')


function Application(options){

  var self = this

  // Set options
  self.options = (options || {})

  // Store things we need to share between modules
  self.preprocessors = {}
  self.responders = {}
  self.routes = {}

  // Set App Root Dir
  self.root = process.cwd().replace(/\\/g, '/')

  // Set environment
  self.env = (process.env['NODE_ENV'] || 'development').toLowerCase()

  // Get current version from package.json
  self.version = loadPackageJSON().version

  // Logger - Allow each level to be overridden with a custom function
  self.log = {
    debug:  function(){},
    info:   function(){},
    error:  console.error
  };

  // Any operation performed on self.clients is applied to all Single Page Clients
  self.clients = new Clients

  // Load System Defaults
  require('./lib/load_defaults')(self)

  // System Event Bus - allows apps to respond to system events
  self.eb = new EventEmitter

  // Websocket experimentation so far... all likely to change below this line
  self.requestProcessor = require('./lib/message_processor')()
  self.stream = MuxDemux()

  return self;

}

// Setup Websocket Transport
Application.prototype.transport = function(mod, options){
  this._transport = mod(this, options)
  return this._transport
}

// Use new Request Responder
Application.prototype.responder = function(name, mod, options){
  this.responders[name] = mod(this, options)
  return this.responders[name]
}

// Define new Single Page Client
Application.prototype.client = function(viewName, paths){
  var client = require('./lib/client');
  var thisClient = new client(this, viewName, paths);
  this.clients.add(thisClient);
  return thisClient;
}

// Create new route for incoming HTTP requests (recursively until we find a matching route)
Application.prototype.route = function(url, clientOrFn){
  if (url[0] != '/') throw new Error('URL must begin with /')
  this.routes[url] = clientOrFn
}

// Route incoming HTTP requests to Single Page Clients or hand over to asset/file server
Application.prototype.router = function(){
  var self = this

  if (!self.routes['/']) throw new Error("You must specify a base route: e.g. app.route('/', mainClient)")
  var matchRoute = require('./lib/http/resolve_route')
  function isStatic (req) { return req.url.indexOf('.') >= 0 }
  
  return function(req, res) {
    if (self.isAssetRequest(req)) return self.serveAssets(req).pipe(res)
    if (isStatic(req)) return self.serveStatic(req, 'client/public').pipe(res)
    // If a route is found, exec function or serve Single Page Client
    if (handler = matchRoute(self.routes, req.url)) {
      typeof handler === 'function' ? handler(req, res) : handler.view(req).pipe(res)
    } else {
      // TODO: Show 404
    }
  }
}

// Define new Code PreProcessor
Application.prototype.preprocessor = function(fileExtension, mod){
  var self = this;
  (typeof fileExtension === 'object' ? fileExtension : [fileExtension]).forEach(function(ext){
    self.preprocessors[ext] = mod;
  })
  return true
}

// Test if this looks like an asset request
Application.prototype.isAssetRequest = function(request){
  return request.url.substring(0,5) === '/_ss/'
}

// Serve CSS and JS over HTTP
Application.prototype.serveAssets = function(request){
  return require('./lib/http/asset_server')(this.root, this.clients, this.preprocessors, request)
}

// Serve static assets (e.g. images) over HTTP
Application.prototype.serveStatic = function(request, dir){
  return require('filed')(path.join(this.root, dir, request.url))
}

// Start listening for Websocket Messages
// Pass the httpServer so the transport can bind to it
Application.prototype.start = function(httpServer, fn) {

  this.connection = this._transport(httpServer)

  // Wire up transport to message handler
  this.connection.pipe(this.requestProcessor)

  // Allow incoming streams of published data through to transport 
  this.stream.pipe(this.connection)

  fn()
}

// Create a new instance
module.exports = function(){
  return new Application
}



// Helpers

function loadPackageJSON () {
  try {
    return JSON.parse(fs.readFileSync(__dirname + '/package.json'));
  } catch (e) {
    throw('Error: Unable to find or parse SocketStream\'s package.json file');
  };
};

