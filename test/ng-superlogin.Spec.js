describe('ng-superlogin', function () {

  var config = {
    providers: ['friendface']
  };

  var testLogin = {
    username: 'superuser',
    password: 'superpass'
  };

  var response = {
    user_id: 'superuser',
    roles: ['user'],
    token: 'abc123',
    password: 'mypass',
    issued: Date.now(),
    expires: Date.now() + 10000,
    userDBs: {
      main: 'http://localhost:5984/test_main$superuser'
    }
  };

  var _time = Date.now();

  var provider;
  var superlogin, superloginSession;

  var $http, $httpBackend, $window, windowOpen, $interval;

  beforeEach(function() {
    // Mock slDateNow
    module('superlogin', function($provide) {
      $provide.factory('slDateNow', function() {
        return function() {
          return _time;
        }
      })
    });
  });

  beforeEach(module('superlogin', function(superloginProvider) {
    provider = superloginProvider;
    superloginProvider.configure(config);
  }));

  beforeEach(inject(function(_superlogin_, _superloginSession_, _$httpBackend_, _$http_, _$window_, _$interval_, _$q_, _$rootScope_){
    superlogin = _superlogin_;
    superloginSession = _superloginSession_;
    $httpBackend = _$httpBackend_;
    $http = _$http_;
    $window = _$window_;
    windowOpen = $window.open;
    $interval = _$interval_;
    $q = _$q_;
    $rootScope = _$rootScope_;
  }));

  beforeEach(function() {
    localStorage.removeItem('superlogin.session');
    localStorage.removeItem('superlogin.oauth');
  });

  afterEach(function() {
    $window.open = windowOpen;
  });

  it('should have superlogin provider', function () {
    expect(superlogin).toBeDefined();
  });

  it('should have a method login()', function () {
    expect(typeof superlogin.login).toBe('function');
  });

  it('should have been configured correctly', function () {
    expect(superlogin.getConfig().baseUrl).toBe('/auth/');
    expect(superlogin.getConfig().providers[0]).toBe('friendface');
  });

  describe('login()', function () {

    it('should make a login request and set a session', function () {
      expect(superlogin.authenticated()).toBe(false);
      $httpBackend.expectPOST('/auth/login', testLogin)
        .respond(201, response);
      superlogin.login(testLogin);
      $httpBackend.flush();
      $httpBackend.verifyNoOutstandingExpectation();
      $httpBackend.verifyNoOutstandingRequest();
      expect(superlogin.getSession().token).toBe('abc123');
      expect(superlogin.authenticated()).toBe(true);
    });

  });

  describe('interceptor', function() {

    beforeEach(function() {
      $httpBackend.whenPOST('/auth/login', testLogin)
        .respond(201, response);
      $httpBackend.whenGET('/unauthorized')
        .respond(401, response);
      superlogin.login(testLogin);
      $httpBackend.flush();
    });

    it('should add a bearer header to any request', function() {
      $httpBackend.expectGET('/test', checkBearerHeader)
        .respond(201, response);
      $http.get('/test');
      $httpBackend.flush();
      $httpBackend.verifyNoOutstandingExpectation();
      $httpBackend.verifyNoOutstandingRequest();
    });

    function checkBearerHeader(header) {
      return header.Authorization === 'Bearer abc123:mypass';
    }

    it('should automatically logout if a request is unauthorized', function() {
      var eventEmitted = false;
      $rootScope.$on('sl:logout', function() {
        eventEmitted = true;
      });
      expect(superlogin.authenticated()).toBe(true);
      $http.get('/unauthorized');
      $httpBackend.flush();
      $httpBackend.verifyNoOutstandingExpectation();
      $httpBackend.verifyNoOutstandingRequest();
      expect(superlogin.authenticated()).toBe(false);
      expect(eventEmitted).toBe(true);
    })

  });

  describe('socialAuth', function() {

    beforeEach(function() {
      $window.open = function() {
        expect(arguments[0]).toBe('/auth/friendface');
        return {closed: true};
      };
    });

    it('should login a user with a social auth popup', function(done) {
      superlogin.socialAuth('friendface')
        .then(function(result) {
          expect(result).toEqual(response);
          done();
        }, function() {
          throw new Error('socialAuth failed');
        });
      $window.superlogin.oauthSession(null, response);
    });

    it('should reject the promise if the user closes the window prior to authentication', function(done) {
      superlogin.socialAuth('friendface')
        .then(function() {
          throw new Error('socialAuth should not have succeeded');
        }, function() {
          done();
        });
      $interval.flush(500);
    })

  });

  describe('refresh', function() {

    it('should refresh a token', function() {
      superloginSession.setSession(angular.copy(response));
      var refreshResponse = {
        token: 'cdf456',
        expires: response.expires + 5000
      };
      $httpBackend.expectPOST('/auth/refresh', {})
        .respond(200, refreshResponse);
      superlogin.refresh();
      $httpBackend.flush();
      $httpBackend.verifyNoOutstandingExpectation();
      $httpBackend.verifyNoOutstandingRequest();
      expect(superlogin.getSession().token).toBe('cdf456');
    })

  });

  describe('checkRefresh', function() {


    beforeEach(function() {
      // Insert a Jasmine spy in superlogin.refresh
      var spy = jasmine.createSpy('refresh').and.callFake(function() {
        return $q.when();
      });
      superlogin.refresh = spy;
      superloginSession.onRefresh(spy);
    });

    it('should not refresh a token if the threshold has not been passed', function() {
      superloginSession.setSession(angular.copy(response));
      _time = response.issued + 4000;
      superlogin.checkRefresh();
      expect(superlogin.refresh).not.toHaveBeenCalled();
    });

    it('should refresh a token if the threshold has been passed', function() {
      superloginSession.setSession(angular.copy(response));
      _time = response.issued + 6000;
      superlogin.checkRefresh();
      expect(superlogin.refresh).toHaveBeenCalled();
    });

    it('should compensate for client time difference', function() {
      var session = angular.copy(response);
      session.issued -= 10000;
      session.expires -= 10000;
      session.serverTimeDiff = -10000;
      superloginSession.setSession(session);
      _time = response.issued + 4000;
      superlogin.checkRefresh();
      expect(superlogin.refresh).not.toHaveBeenCalled();
    });

  });

});