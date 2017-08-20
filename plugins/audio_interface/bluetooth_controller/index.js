'use strict';

// load external modules
var libQ = require('kew');
var fs = require('fs-extra');
var io = require('socket.io-client');
var blue = require('bluetoothctl');
var execSync = require('child_process').execSync;

blue.Bluetooth();

var socket = io.connect('http://localhost:3000');

// Define the BluetoothController class
module.exports = BluetoothController;


function BluetoothController(context) {
    var self = this;

    // Save a reference to the parent commandRouter
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.commandRouter.logger;
    this.configManager = this.context.configManager;
};

// define behaviour on system start up. In our case just read config file
BluetoothController.prototype.onVolumioStart = function() {
    var self = this;
    var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
};

// Volumio needs this
BluetoothController.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

// define behaviour on plugin activation
BluetoothController.prototype.onStart = function () {
    var self = this;
    var defer = libQ.defer();
    
    self.initBluetooth();

    defer.resolve();
    return defer.promise;
};

// define behaviour on plugin deactivation.
BluetoothController.prototype.onStop = function () {
    var self = this;
    var defer = libQ.defer();


    return defer.promise;
};

// initialize Plugin settings page
BluetoothController.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;
    self.logger.info('Discoverable: ' + self.config.get('discoverable'));

    var lang_code = this.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf) {
            uiconf.sections[0].content[0].value = self.config.get('discoverable');
            defer.resolve(uiconf);
        })
        .fail(function () {
            defer.reject(new Error());
        });

    return defer.promise;
};

// define what happens when the user clicks the 'save' button on the settings page
BluetoothController.prototype.saveOptions = function(data) {
    var self = this;
    var successful = true;

    // save discoverable setting to our config
    self.config.set('discoverable', data['discoverable_setting']);
    self.initBluetooth();

    self.commandRouter.pushToastMessage('success', self.commandRouter.getI18nString('BLUETOOTH_SETTINGS'), self.commandRouter.getI18nString('COMMON.SETTINGS_SAVED_SUCCESSFULLY'));
};

// initialize bluetooth controller and start scan
BluetoothController.prototype.initBluetooth = function() {
    var self = this;
    var hasBluetooth = blue.checkBluetoothController();
    if (hasBluetooth) {
        self.logger.info('Set bluetooth disvoverable to ' + self.config.get('discoverable'));
        blue.discoverable(self.config.get('discoverable'));
        self.startScan();
    }
};

// start scan for bluetooth devices
BluetoothController.prototype.startScan = function() {
    var self = this;
    self.logger.info('Starting bluetooth device scan');
    blue.scan(true);
    // stop scan after a while to prevent playback issues
    setTimeout(function() {
        self.logger.info('Stopping bluetooth device scan');
        blue.scan(false);
    }, 20000);
};

// return list of bluetooth devices
BluetoothController.prototype.getBluetoothDevices = function(defer) {
    var self = this;
    var defer = libQ.defer();
    
    // start scanning 
    self.startScan();
    

    // build result
    var state = {};
    state.hasBluetooth = blue.checkBluetoothController();
    state.devices = blue.devices;
    
    var result = {};
    result.message = "pushBluetoothDevices";
    result.payload = state;

    self.logger.info('Found bluetooth devices: ' + JSON.stringify(result, null, 4));
    
    return result; 
};

// connects the specified bluetooth device
BluetoothController.prototype.connectBluetoothDevice = function(data) {
    var self = this;
    var defer = libQ.defer();
    var mac = data.mac.toString();
    self.logger.info('Connecting bluetooth devices: ' + mac);
    blue.pair(mac);
    blue.trust(mac);
    blue.connect(mac);

    self.writeAsoundFile(mac);

    return self.getBluetoothDevices();
};

// disconnects the specified bluetooth device
BluetoothController.prototype.disconnectBluetoothDevice = function(data) {
    var self = this;
    var defer = libQ.defer();
    var mac = data.mac.toString();
    self.logger.info('Disconnecting bluetooth devices: ' + mac);
    blue.disconnect(mac);
    blue.untrust(mac);
    blue.remove(mac);
    
    self.writeAsoundFile();

    return self.getBluetoothDevices();
};

BluetoothController.prototype.getPaired = function() {
    var self = this;
    var defer = libQ.defer();

    defer.resolve(blue.getPairedDevices);
    return defer.promise;
};

BluetoothController.prototype.getBluetoothAvailable = function() {
    var self = this;
    var defer = libQ.defer();

    defer.resolve( blue.checkBluetoothController());
    return defer.promise;
};

BluetoothController.prototype.writeAsoundFile = function(mac) {
	var self = this;
    var defer = libQ.defer();
	self.logger.info('Change softmixer device for audio device to:' + mac);


	var asoundcontent = '';

    if (mac !== undefined)
    {
        asoundcontent += 'defaults.bluealsa { \n';
        asoundcontent += 'interface "hci0"            # host Bluetooth adapter \n';
        asoundcontent += '   device "' + mac + '"  # Bluetooth headset MAC address \n';
        asoundcontent += '   profile "a2dp" \n';
        asoundcontent += '}/n';
    }


	fs.writeFile('/home/volumio/.asoundrc', asoundcontent, 'utf8', function(err) {
		if (err) {
			self.logger.info('Cannot write /var/lib/mpd/.asoundrc: ' + err);
		} else {
			self.logger.info('asoundrc file written');
			var mv = execSync('/usr/bin/sudo /bin/mv /home/volumio/.asoundrc /var/lib/mpd/.asoundrc', { uid:1000, gid: 1000, encoding: 'utf8' });
			var apply = execSync('/usr/sbin/alsactl -L -R nrestore', { uid:1000, gid: 1000, encoding: 'utf8' });
			var apply3 = execSync('/usr/sbin/alsactl -L -R nrestore', { uid:1000, gid: 1000, encoding: 'utf8' });
		}
	});
};
