/**
 * Reads energy data from a smart meter via a RAVEn RFA-Z106 dongle (http://www.rainforestautomation.com/raven) and uploads to ThingSpeak.
 hacked from stormboy's node-raven https://github.com/stormboy/node-raven
 by Sam C. Lin

 ThingSpeak channel fields:
 field1: instantaneous usage
 field2: cumulative net usage
 field3: cumulative energy in
 field4: cumulative energy out
 field5: daily net energy
 */

var serialport = require("serialport"),
ThingSpeakClient = require('thingspeakclient'),
xml2js = require('xml2js');

process.on('uncaughtException', function(err) {
    // handle the error safely
    console.log(err);
});

var TRACE = true;

// RAVEn's serial port
var ravenSerialPath = '/dev/ttyUSB0';

// thingspeak parameters
var channelId = YOUR-THINGSPEAK-CHANNEL-ID;
var apiKey = 'YOUR THINGSPEAK-WRITE-API-KEY';

var tsclient = new ThingSpeakClient();
tsclient.attachChannel(channelId, { writeKey:apiKey});

// date offset for RAVEn which presents timestamp as seconds since 2000-01-01
var dateOffset = Date.UTC(2000, 0, 1);

var dailyNet = 0;
var dailyNetSentDate = 0;

var Raven = function(serialPath) {
    var self = this;
    
    // configure the serial port that the RAVEn USB dongle is on.
    this.serialPort = new serialport.SerialPort(serialPath, {
        baudrate: 115200,
        databits: 8,
        stopbits: 1,
        parity: 'none',
        parser: serialport.parsers.readline("\r\n") 
    });
    
    this.serialPort.on("open", function() {
        openHandler(self);
    });
};


/**
 * Get the connection status between the USB device and the power meter 
 */
Raven.prototype.getConnectionStatus = function() {
    var queryCommand = "<Command><Name>get_connection_status</Name></Command>\r\n";
    this.serialPort.write(queryCommand);
};

/**
 * Get information about the device
 */
Raven.prototype.getDeviceInfo = function() {
    var queryCommand = "<Command><Name>get_device_info</Name></Command>\r\n";
    this.serialPort.write(queryCommand);
};

/**
 * Query the amount of energy used or fed-in.
 */
Raven.prototype.getSumEnergy = function() {
    var queryCommand = "<Command><Name>get_current_summation_delivered</Name></Command>\r\n";
    this.serialPort.write(queryCommand);
};

/**
 * Get the power currently being used (or fed-in)
 */
Raven.prototype.getSumPower = function() {
    var queryCommand = "<Command><Name>get_instantaneous_demand</Name></Command>\r\n";
    this.serialPort.write(queryCommand);
};

Raven.prototype.getMessage = function() {
    var queryCommand = "<Command><Name>get_message</Name></Command>\r\n";
    this.serialPort.write(queryCommand);
};

Raven.prototype.getTime = function() {
    var queryCommand = "<Command><Name>get_time</Name></Command>\r\n";
    this.serialPort.write(queryCommand);
};

Raven.prototype.getCurrentPrice = function() {
    var queryCommand = "<Command><Name>get_current_price</Name></Command>\r\n";
    this.serialPort.write(queryCommand);
};

Raven.prototype.close = function() {
    this.serialPort.close();
};

// handle serial port open
function openHandler (self) {
    var parser = new xml2js.Parser();
    var buffer = "";	// read buffer.

    if (TRACE) {	
    	console.log('serial device open');
    }
    
    // add serial port data handler	
    self.serialPort.on('data', function(data) {
	try {
	buffer += data.toString() + "\r\n";		// append to the read buffer
	if ( data.toString().indexOf('</') == 0 ) {		// check if last part of XML element.
	    
	    // try to parse buffer
	    parser.parseString(buffer, function (err, result) {
		if (err) {
		    console.log("err: " + err);
		    console.log('data received: ' + buffer);
		}
		else if (result.InstantaneousDemand) {
		    var timestamp = parseInt( result.InstantaneousDemand.TimeStamp );
		    timestamp = new Date(dateOffset+timestamp*1000);
		    var demand = parseInt( result.InstantaneousDemand.Demand, 16 );
		    demand = demand < 0x80000000 ? demand : - ~demand - 1;
		    if (TRACE) {
			console.log("demand: " + timestamp.toLocaleString() + " : " + demand);
		    }
		    var tsData = new Object();
		    tsData = { field1: demand };
		    tsclient.updateChannel(channelId,tsData);
		}
		else if (result.CurrentSummationDelivered) {
		    var timestamp = parseInt( result.CurrentSummationDelivered.TimeStamp );
		    timestamp = new Date(dateOffset+timestamp*1000);
		    var used = parseInt( result.CurrentSummationDelivered.SummationDelivered, 16 );
		    var fedin = parseInt( result.CurrentSummationDelivered.SummationReceived, 16 );
		    var curDate = timestamp.getDate();
		    var net = used - fedin;

		    if (dailyNet == 0) {
			dailyNet = net;
			dailyNetSentDate = curDate;
		    }
		    
		    if (TRACE) {
		    console.log("sum: " + timestamp.toLocaleString() + " : " + used + " - " + fedin);
		    }

		    var tsData = new Object();
		    tsData = { field2: net,field3: used,field4: fedin};
		    
		    // only send daily net once a day
		    if (curDate !== dailyNetSentDate) {
			tsData.field5 = net - dailyNet;
			dailyNet = net;
			dailyNetSentDate = curDate;
		    }

		    tsclient.updateChannel(channelId,tsData);

		}
		else if (result.ConnectionStatus) {
		    if (TRACE) {
			console.log("connection status: " + result.ConnectionStatus.Status);
		    }
		}
		else {
		    if (TRACE) {
			console.dir(result);	// display data read in
		    }
		}
	    });
	    buffer = "";	// reset the read buffer
	}
	}
	catch(err) { console.log(err); }
    });
}

var raven = Raven(ravenSerialPath);