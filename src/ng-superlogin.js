'use strict';
/* global angular */
/* jshint -W097 */

angular.module('superlogin', [])

  .config(['$httpProvider', function($httpProvider) {
    $httpProvider.interceptors.push('superloginInterceptor');
  }])

  .factory('slDateNow', function() {
    return function(){
      return Date.now();
    };
  })

  .provider('superloginSession', ['$windowProvider', function($windowProvider) {
    var $window = $windowProvider.$get();
    var _config, _session, _refreshCB, _refreshInProgress;
    var self = this;

    this.configure = function(config) {
      config = config || {};
      config.baseUrl = config.baseUrl || '/auth/';
      if(!config.endpoints || !(config.endpoints instanceof Array)) {
        config.endpoints = [];
      }
      if(!config.noDefaultEndpoint) {
        var parser = $window.document.createElement('a');
        parser.href = '/';
        config.endpoints.push(parser.host);
      }
      config.providers = config.providers || [];
      _config = config;
    };

    this.$get = ['$window', '$rootScope', 'slDateNow', function($window, $rootScope, slDateNow) {
      // Apply defaults if there is no config
      if(!_config) {
        self.configure({});
      }
      var storage;
      if(_config.storage === 'session') {
        storage = $window.sessionStorage;
      } else {
       storage = $window.localStorage;
      }
      $rootScope.superlogin = {};

      // Login and logout handlers
      $rootScope.$on('sl:login', function(event, session) {
        $rootScope.superlogin.session = session;
        $rootScope.superlogin.authenticated = true;
      });
      $rootScope.$on('sl:logout', function() {
        $rootScope.superlogin.session = null;
        $rootScope.superlogin.authenticated = false;
      });

      // Setup the new session
      _session = JSON.parse(storage.getItem('superlogin.session'));
      if(_session) {
        $rootScope.$broadcast('sl:login', _session);
      }

      function deleteSession() {
        storage.removeItem('superlogin.session');
        _session = null;
      }

      function checkExpired() {
        // This is not necessary if we are not authenticated
        if(!_session || !_session.user_id) {
          return;
        }
        var expires = _session.expires;
        var timeDiff = _session.serverTimeDiff || 0;
        // Only compensate for time difference if it is greater than 5 seconds
        if(Math.abs(timeDiff) < 5000) {
          timeDiff = 0;
        }
        var estimatedServerTime = slDateNow() + timeDiff;
        if(estimatedServerTime > expires) {
          deleteSession();
          $rootScope.$broadcast('sl:logout', 'Session expired');
        }
      }

      // Check expired
      if(_config.checkExpired === 'startup' || _config.checkExpired === 'stateChange') {
        checkExpired();
      }
      if(_config.checkExpired === 'stateChange') {
        // Events for both Angular Router and UI Router
        $rootScope.$on('$routeChangeStart', function() {
          checkExpired();
        });
        $rootScope.$on('$stateChangeStart', function() {
          checkExpired();
        });
      }

      return {
        authenticated: function() {
          return !!(_session && _session.user_id);
        },
        getSession: function() {
          return _session || JSON.parse(storage.getItem('superlogin.session'));
        },
        setSession: function(session) {
          _session = session;
          storage.setItem('superlogin.session', JSON.stringify(_session));
        },
        deleteSession: deleteSession,
        getConfig: function() {
          return _config;
        },
        getDbUrl: function(dbName) {
          if(_session.userDBs && _session.userDBs[dbName]) {
            return _session.userDBs[dbName];
          } else {
            return null;
          }
        },
        confirmRole: function(role) {
          if (!_session || !_session.roles || !_session.roles.length) return false;
          return _session.roles.indexOf(role) !== -1;
        },
        confirmAnyRole: function(roles) {
          if (!_session || !_session.roles || !_session.roles.length) return false;
          for (var i = 0; i < roles.length; i++) {
            if (_session.roles.indexOf(roles[i]) !== -1) return true;
          }
        },
        confirmAllRoles: function(roles) {
          if (!_session || !_session.roles || !_session.roles.length) return false;
          for (var i = 0; i < roles.length; i++) {
            if (_session.roles.indexOf(roles[i]) === -1) return false;
          }
          return true;
        },
        checkExpired: checkExpired,
        checkRefresh: function() {
          // Get out if we are not authenticated or a refresh is already in progress
          if(_refreshInProgress || (!_session || !_session.user_id)) {
            return;
          }
          var issued = _session.issued;
          var expires = _session.expires;
          var threshold = _config.refreshThreshold || 0.5;
          var duration = expires - issued;
          var timeDiff = _session.serverTimeDiff || 0;
          if(Math.abs(timeDiff) < 5000) {
            timeDiff = 0;
          }
          var estimatedServerTime = slDateNow() + timeDiff;
          var elapsed = estimatedServerTime - issued;
          var ratio = elapsed / duration;
          if((ratio > threshold) && (typeof _refreshCB === 'function')) {
            _refreshInProgress = true;
            _refreshCB()
              .then(function() {
                _refreshInProgress = false;
              }, function() {
                _refreshInProgress = false;
              });
          }
        },
        onRefresh: function(cb) {
          _refreshCB = cb;
        }
      };
    }];

  }])

  .provider('superlogin', ['superloginSessionProvider', function(superloginSessionProvider) {

    this.configure = superloginSessionProvider.configure;

    this.$get = ['$http', '$q', '$window', '$interval', '$rootScope', 'superloginSession', 'slDateNow' ,function($http, $q, $window, $interval, $rootScope, superloginSession, slDateNow) {

      var oauthDeferred, oauthComplete;

      $window.superlogin = {};
      $window.superlogin.oauthSession = function(error, session, link) {
        if(!error && session) {
          session.serverTimeDiff = session.issued - slDateNow();
          superloginSession.setSession(session);
          $rootScope.$broadcast('sl:login', session);
          oauthDeferred.resolve(session);
        } else if(!error && link) {
          $rootScope.$broadcast('sl:link', link);
          oauthDeferred.resolve(capitalizeFirstLetter(link) + ' successfully linked.');
        } else {
          oauthDeferred.reject(error);
        }
        oauthComplete = true;
        $rootScope.$apply();
      };

      superloginSession.onRefresh(refresh);

      return {
        authenticated: superloginSession.authenticated,
        getConfig: superloginSession.getConfig,
        getSession: superloginSession.getSession,
        deleteSession: superloginSession.deleteSession,
        getDbUrl: superloginSession.getDbUrl,
        confirmRole: superloginSession.confirmRole,
        confirmAnyRole: superloginSession.confirmAnyRole,
        confirmAllRoles: superloginSession.confirmAllRoles,
        refresh: refresh,
        checkRefresh: superloginSession.checkRefresh,
        checkExpired: superloginSession.checkExpired,
        authenticate: function($q) {
          var deferred = $q.defer();
          var session = superloginSession.getSession();
          if(session) {
            deferred.resolve(session);
          } else {
            $rootScope.$on('sl:login', function(event, newSession) {
              deferred.resolve(newSession);
            });
          }
          return deferred.promise;
        },
        login: function(credentials) {
          if(!credentials.username || !credentials.password) {
            return $q.reject('Username or Password missing...');
          }
          var req = {
            method: 'POST',
            url: superloginSession.getConfig().baseUrl + 'login',
            data: credentials
          };
          return $http(req)
            .then(function(res) {
              res.data.serverTimeDiff = res.data.issued - slDateNow();
              superloginSession.setSession(res.data);
              $rootScope.$broadcast('sl:login', res.data);
              return $q.when(res.data);
            }, function(err) {
              superloginSession.deleteSession();
              return $q.reject(err.data);
            });
        },
        register: function(registration) {
          var req = {
            method: 'POST',
            url: superloginSession.getConfig().baseUrl + 'register',
            data: registration
          };
          return $http(req)
            .then(function(res) {
              if(res.data.user_id && res.data.token) {
                res.data.serverTimeDiff = res.data.issued - slDateNow();
                superloginSession.setSession(res.data);
                $rootScope.$broadcast('sl:login', res.data);
              }
              return $q.when(res.data);
            }, function(err) {
              return $q.reject(err.data);
            });
        },
        logout: function(msg) {
          return $http.post(superloginSession.getConfig().baseUrl + 'logout', {})
            .then(function(res) {
              superloginSession.deleteSession();
              $rootScope.$broadcast('sl:logout', msg || 'Logged out');
              return $q.when(res.data);
            }, function(err) {
              superloginSession.deleteSession();
              $rootScope.$broadcast('sl:logout', msg || 'Logged out');
              return $q.reject(err.data);
            });
        },
        logoutAll: function(msg) {
          return $http.post(superloginSession.getConfig().baseUrl + 'logout-all', {})
            .then(function(res) {
              superloginSession.deleteSession();
              $rootScope.$broadcast('sl:logout', msg || 'Logged out');
              return $q.when(res.data);
            }, function(err) {
              superloginSession.deleteSession();
              $rootScope.$broadcast('sl:logout', msg || 'Logged out');
              return $q.when(err.data);
            });
        },
        logoutOthers: function() {
          return $http.post(superloginSession.getConfig().baseUrl + 'logout-others', {})
            .then(function(res) {
              return $q.when(res.data);
            }, function(err) {
              return $q.reject(err.data);
            });
        },
        socialAuth: function(provider) {
          var providers = superloginSession.getConfig().providers;
          if(providers.indexOf(provider) === -1) {
            return $q.reject({error: 'Provider ' + provider + ' not supported.'});
          }
          return oAuthPopup(superloginSession.getConfig().baseUrl + provider, {windowTitle: 'Login with ' + capitalizeFirstLetter(provider)});
        },
        tokenSocialAuth: function(provider, accessToken) {
          var providers = superloginSession.getConfig().providers;
          if(providers.indexOf(provider) === -1) {
            return $q.reject({error: 'Provider ' + provider + ' not supported.'});
          }
          return $http.post(superloginSession.getConfig().baseUrl + provider + '/token', {access_token: accessToken})
            .then(function(res) {
              if(res.data.user_id && res.data.token) {
                res.data.serverTimeDiff = res.data.issued - slDateNow();
                superloginSession.setSession(res.data);
                $rootScope.$broadcast('sl:login', res.data);
              }
              return $q.when(res.data);
            }, function(err) {
              return $q.reject(err.data);
            });
        },
        tokenLink: function(provider, accessToken) {
          var providers = superloginSession.getConfig().providers;
          if(providers.indexOf(provider) === -1) {
            return $q.reject({error: 'Provider ' + provider + ' not supported.'});
          }
          return $http.post(superloginSession.getConfig().baseUrl + 'link/' + provider + '/token', {access_token: accessToken})
            .then(function(res) {
              return $q.when(res.data);
            }, function(err) {
              return $q.reject(err.data);
            });
        },
        link: function(provider) {
          var providers = superloginSession.getConfig().providers;
          if(providers.indexOf(provider) === -1) {
            return $q.reject({error: 'Provider ' + provider + ' not supported.'});
          }
          if(superloginSession.authenticated()) {
            var session = superloginSession.getSession();
            var linkURL = superloginSession.getConfig().baseUrl + 'link/' + provider + '?bearer_token=' + session.token + ':' + session.password;
            return oAuthPopup(linkURL, {windowTitle: 'Link your account to ' + capitalizeFirstLetter(provider)});
          }
          return $q.reject({error: 'Authentication required'});
        },
        unlink: function(provider) {
          var providers = superloginSession.getConfig().providers;
          if(providers.indexOf(provider) === -1) {
            return $q.reject({error: 'Provider ' + provider + ' not supported.'});
          }
          if(superloginSession.authenticated()) {
            return $http.post(superloginSession.getConfig().baseUrl + 'unlink/' + provider)
              .then(function(res) {
                return $q.when(res.data);
              }, function(err) {
                return $q.reject(err.data);
              });
          }
          return $q.reject({error: 'Authentication required'});
        },
        verifyEmail: function(token) {
          if(!token || typeof token !== 'string') {
            return $q.reject({error: 'Invalid token'});
          }
          return $http.get(superloginSession.getConfig().baseUrl + 'verify-email/' + token)
            .then(function(res) {
              return $q.when(res.data);
            }, function(err) {
              return $q.reject(err.data);
            });
        },
        forgotPassword: function(email) {
          return $http.post(superloginSession.getConfig().baseUrl + 'forgot-password', {email: email})
            .then(function(res) {
              return $q.when(res.data);
            }, function(err) {
              return $q.reject(err.data);
            });
        },
        resetPassword: function(form) {
          return $http.post(superloginSession.getConfig().baseUrl + 'password-reset', form)
            .then(function(res) {
              if(res.data.user_id && res.data.token) {
                superloginSession.setSession(res.data);
                $rootScope.$broadcast('sl:login', res.data);
              }
              return $q.when(res.data);
            }, function(err) {
              return $q.reject(err.data);
            });
        },
        changePassword: function(form) {
          if(superloginSession.authenticated()) {
            return $http.post(superloginSession.getConfig().baseUrl + 'password-change', form)
              .then(function (res) {
                return $q.when(res.data);
              }, function (err) {
                return $q.reject(err.data);
              });
          }
          return $q.reject({error: 'Authentication required'});
        },
        changeEmail: function(newEmail) {
          if(superloginSession.authenticated()) {
            return $http.post(superloginSession.getConfig().baseUrl + 'change-email', {newEmail: newEmail})
              .then(function (res) {
                return $q.when(res.data);
              }, function (err) {
                return $q.reject(err.data);
              });
          }
          return $q.reject({error: 'Authentication required'});
        },
        validateUsername: function(username) {
          return $http.get(superloginSession.getConfig().baseUrl + 'validate-username/' + encodeURIComponent(username))
            .then(function() {
              return $q.when(true);
            }, function(err) {
              if(err.status === 409) {
                return $q.reject(false);
              }
              return $q.reject(err);
            });
        },
        validateEmail: function(email) {
          return $http.get(superloginSession.getConfig().baseUrl + 'validate-email/' + encodeURIComponent(email))
            .then(function () {
              return $q.when(true);
            }, function (err) {
              if(err.status === 409) {
                return $q.reject(false);
              }
              return $q.reject(err);
            });
        }
      };

      function refresh() {
        var session = superloginSession.getSession();
        return $http.post(superloginSession.getConfig().baseUrl + 'refresh', {})
          .then(function(res) {
            if(res.data.token && res.data.expires) {
              session.expires = res.data.expires;
              session.token = res.data.token;
              superloginSession.setSession(session);
              $rootScope.$broadcast('sl:refresh', session);
              return $q.when(session);
            }
          }, function(err) {
            return $q.reject(err.data);
          });
      }

      function oAuthPopup(url, options) {
        oauthDeferred = $q.defer();
        oauthComplete = false;
        options.windowName = options.windowName ||  'Social Login';
        options.windowOptions = options.windowOptions || 'location=0,status=0,width=800,height=600';
        var _oauthWindow = $window.open(url, options.windowName, options.windowOptions);
        var _oauthInterval = $interval(function(){
          if (_oauthWindow.closed) {
            $interval.cancel(_oauthInterval);
            if(!oauthComplete) {
              oauthDeferred.reject('Authorization cancelled');
              oauthComplete = true;
            }
          }
        }, 500);
        return oauthDeferred.promise;
      }

      // Capitalizes the first letter of a string
      function capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
      }

    }];

  }])

  .service('superloginInterceptor', ['$rootScope', '$q', '$window', '$location', 'superloginSession', function($rootScope, $q, $window, $location, superloginSession) {
    var service = this;
    var parser = $window.document.createElement('a');
    var config = superloginSession.getConfig();
    var endpoints = config.endpoints;

    service.request = function(request) {
      var session = superloginSession.getSession();
      if(session && session.token) {
        superloginSession.checkRefresh();
      }
      if(checkEndpoint(request.url, endpoints)) {
        if(session && session.token) {
          request.headers.Authorization = 'Bearer ' + session.token + ':' + session.password;
        }
      }
      return request;
    };

    service.responseError = function(response) {
      // If there is an unauthorized error from one of our endpoints and we are logged in...
      if (checkEndpoint(response.config.url, endpoints) && response.status === 401 && superloginSession.authenticated()) {
        superloginSession.deleteSession();
        $rootScope.$broadcast('sl:logout', 'Session expired');
      }
      return $q.reject(response);
    };

    function checkEndpoint(url, endpoints) {
      parser.href = url;
      for(var i=0; i<endpoints.length; i++) {
        if(parser.host === endpoints[i]) {
          return true;
        }
      }
      return false;
    }

  }]);
