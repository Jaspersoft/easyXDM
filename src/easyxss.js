
/*jslint evil:true, browser: true, forin: true, immed: true, passfail: true, undef: true */
/*global window, escape, unescape */

// #ifdef debug
if (typeof console === "undefined") {
    window.console = {
        info: function(){
        },
        log: function(){
        },
        error: function(){
        }
    };
}
/**
 * Traces the message prefixed by the host
 * @param {String} msg
 */
function trace(msg){
    console.info(location.host + ":" + msg);
}

// #endif
/** 
 * A javascript library providing cross-browser, cross-site messaging/method invocation
 * @version %%version%%
 * @namespace
 */
var easyXSS = {
    /**
     * The version of the library
     */
    version: "%%version%%",
    /**
     * Creates an interface that can be used to call methods implemented
     * on the remote end of the channel, and also to provide the implementation
     * of methods to be called from the remote end.
     * @requires JSON
     * @param {String} channel A valid channel for transportation
     * @param {easyXSS.Interface.InterfaceConfiguration} config A valid easyXSS-definition
     * @param {Function} onready A method that should be called when the interface is ready
     */
    createInterface: function(channel, config, onready){
        // #ifdef debug
        trace("creating new interface");
        // #endif
        var _callbackCounter = 0, _callbacks = {};
        var _local = (config.local) ? config.local : null;
        
        function _onData(data, origin){
            // #ifdef debug
            trace("interface$_onData:(" + data + "," + origin + ")");
            // #endif
            /// <summary>
            /// Receives either a request or a response from the other
            /// end of the channel
            /// </summary>
            /// <param name="data" type="object">The request/repsonse</param>
            if (data.name) {
                // A method call from the remote end
                var method = _local[data.name];
                if (!method) {
                    throw "The method " + data.name + " is not implemented.";
                }
                if (method.isAsync) {
                    // #ifdef debug
                    trace("requested to execute async method " + data.name);
                    // #endif
                    // The method is async, we need to add a callback
                    data.params.push(function(result){
                        // Send back the result
                        channel.sendData({
                            id: data.id,
                            response: result
                        });
                    });
                    // Call local method
                    method.method.apply(null, data.params);
                }
                else {
                    if (method.isVoid) {
                        // #ifdef debug
                        trace("requested to execute void method " + data.name);
                        // #endif
                        // Call local method 
                        method.method.apply(null, data.params);
                    }
                    else {
                        // #ifdef debug
                        trace("requested to execute method " + data.name);
                        // #endif
                        // Call local method and send back the response
                        channel.sendData({
                            id: data.id,
                            response: method.method.apply(null, data.params)
                        });
                    }
                }
            }
            else {
                // #ifdef debug
                trace("received return value destined to callback with id " + data.id);
                // #endif
                // A method response from the other end
                _callbacks[data.id](data.response);
                delete _callbacks[data.id];
            }
        }
        
        function _createRemote(methods){
            // #ifdef debug
            trace("creating concrete implementations");
            // #endif
            /// <summary>
            /// Creates a proxy to the methods located on the other end of the channel
            /// <summary>
            /// <param name="methods" type="Object">A description of the interface to implement</param>
            function _createConcrete(definition, name){
                /// <summary>
                /// Creates the concrete implementation of the supplied definition
                /// </summary>
                /// <param name="definitin" type="Object"/>
                /// <param name="name" type="String">The name of the method to expose</param>
                if (definition.isVoid) {
                    // #ifdef debug
                    trace("creating void method " + name);
                    // #endif
                    // No need to register a callback
                    return function(){
                        // #ifdef debug
                        trace("executing void method " + name);
                        // #endif
                        var params = [];
                        for (var i = 0, len = arguments.length; i < len; i++) {
                            params[i] = arguments[i];
                        }
                        // Send the method request
                        window.setTimeout(function(){
                            channel.sendData({
                                name: name,
                                params: params
                            });
                        }, 0);
                    };
                }
                else {
                    // #ifdef debug
                    trace("creating method " + name);
                    // #endif
                    // We need to extract and register the callback
                    return function(){
                        // #ifdef debug
                        trace("executing method " + name);
                        // #endif
                        _callbacks["" + (_callbackCounter)] = arguments[arguments.length - 1];
                        var request = {
                            name: name,
                            id: (_callbackCounter++),
                            params: []
                        };
                        for (var i = 0, len = arguments.length - 1; i < len; i++) {
                            request.params[i] = arguments[i];
                        }
                        // Send the method request
                        window.setTimeout(function(){
                            channel.sendData(request);
                        }, 0);
                    };
                }
            }
            var concrete = {};
            for (var name in methods) {
                concrete[name] = _createConcrete(methods[name], name);
            }
            return concrete;
        }
        channel.setOnData(_onData);
        channel.setConverter(JSON);
        if (onready) {
            window.setTimeout(onready, 10);
        }
        
        return (config.remote) ? _createRemote(config.remote) : null;
    },
    /**
     * Creates a transport channel using the available parameters.
     * Parameters are collected both from the supplied config,
     * but also from the querystring if not present in the config.
     * @param {easyXSS.Transport.TransportConfiguration} config The transports configuration
     * @return An object able to send and receive messages
     * @type easyXSS.Transport.ITransport
     */
    createTransport: function(config){
        if (config.local) {
            config.channel = (config.channel) ? config.channel : "default";
        }
        else {
            var query = easyXSS.Url.Query();
            config.channel = query.channel;
            config.remote = query.endpoint;
        }
        // #ifdef debug
        trace("creating transport for channel " + config.channel);
        // #endif
        if (window.postMessage) {
            return new easyXSS.Transport.PostMessageTransport(config);
        }
        else {
            return new easyXSS.Transport.HashTransport(config);
        }
    },
    /**
     * The channels configuration
     * @extends easyXSS.Transport.TransportConfiguration
     * @class
     */
    ChannelConfiguration: {
        /**
         * The serializer to use
         * @type easyXSS.Serializing.ISerializer
         */
        converter: {}
    },
    /**
     * A channel
     * @constructor
     * @param {easyXSS.ChannelConfiguration} config The channels configuration
     */
    Channel: function(config){
        // #ifdef debug
        trace("easyXSS.Channel.constructor");
        // #endif
        var sendData;
        if (config.converter) {
            // #ifdef debug
            trace("implementing serializer");
            // #endif
            /**
             * Wraps the onMessage method using the supplied serializer to convert
             * @param {Object} data
             * @ignore
             */
            config.onMessage = function(message, origin){
                this.onData(this.converter.parse(message), origin);
            };
            /**
             * Wraps the postMessage method using hte supplied serializer to convert
             * @param {Object} data
             * @ignore
             */
            sendData = function(data){
                this.transport.postMessage(config.converter.stringify(data));
            };
        }
        else {
            config.onMessage = config.onData;
            /**
             * @param {Object} message
             * @ignore
             */
            sendData = function(message){
                this.transport.postMessage(message);
            };
        }
        
        return {
            /**
             * The underlying transport used by this channel
             * @type easyXSS.Transport.ITransport
             */
            transport: easyXSS.createTransport(/** easyXSS.Transport.TransportConfiguration*/config),
            /**
             * Sets the serializer to be used when transmitting and receiving messages
             * @param {Object} converter The serializer to use
             */
            setConverter: function(converter){
                // #ifdef debug
                trace("implementing serializer after initialization");
                // #endif
                config.converter = converter;
                /**
                 * Wraps the postMessage method using the supplied serializer to convert
                 * @param {Object} data
                 * @ignore
                 */
                this.sendData = function(data){
                    this.transport.postMessage(config.converter.stringify(data));
                };
                /**
                 * Wraps the onData method using the supplied serializer to convert
                 * @param {String} message
                 * @param {String} origin
                 * @ignore
                 */
                config.onMessage = function(message, origin){
                    this.onData(this.converter.parse(message), origin);
                };
            },
            /**
             * Sets the method that should handle incoming messages
             * @param {Function} onData
             */
            setOnData: function(onData){
                // #ifdef debug
                trace("overriding onData after intialization");
                // #endif
                config.onData = onData;
            },
            /**
             * Tries to destroy the underlying transport
             */
            destroy: function(){
                // #ifdef debug
                trace("easyXSS.Channel.destroy");
                // #endif
                this.transport.destroy();
            },
            /**
             * Send data using the underlying transport
             * If a serializer is specified then this will be used to serialize the data first.
             * @param {Object} data
             */
            sendData: sendData
        };
    },
    /**
     * Creates a wrapper around the available transport mechanism that
     * also enables you to insert a serializer for the messages transmitted.
     * @param {easyXSS.ChannelConfiguration} config The channels configuration
     * @return An object able to send and receive arbitrary data
     * @type easyXSS.Channel
     */
    createChannel: function(config){
        // #ifdef debug
        trace("creating channel");
        // #endif
        return new easyXSS.Channel(config);
    }
};
