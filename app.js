/**
 * Module dependencies.
 */

/*eslint-env node */
var express = require('express'), routes = require('./routes'), user = require('./routes/user'), http = require('http'), path = require('path'), fs = require('fs');

var nodemailer = require("nodemailer");
var smtpTransport = nodemailer.createTransport("SMTP", {
	service : "Gmail",
	auth: {
		user: "do.not.reply.teamup@gmail.com",
		pass: "cmpe27212345"
	}
});

var app = express();

var db;

var cloudant;

var dbCredentials = {
	dbName : 'cmpe_272_teamup_db'
};

var bodyParser = require('body-parser');
var methodOverride = require('method-override');
var logger = require('morgan');
var errorHandler = require('errorhandler');
var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);
app.use(logger('dev'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(methodOverride());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/style', express.static(path.join(__dirname, '/views/style')));

// development only
if ('development' == app.get('env')) {
	app.use(errorHandler());
}

function initDBConnection() {
	
	if(process.env.VCAP_SERVICES) {
		var vcapServices = JSON.parse(process.env.VCAP_SERVICES);
		// Pattern match to find the first instance of a Cloudant service in
		// VCAP_SERVICES. If you know your service key, you can access the
		// service credentials directly by using the vcapServices object.
		for(var vcapService in vcapServices){
			if(vcapService.match(/cloudant/i)){
				dbCredentials.host = vcapServices[vcapService][0].credentials.host;
				dbCredentials.port = vcapServices[vcapService][0].credentials.port;
				dbCredentials.user = vcapServices[vcapService][0].credentials.username;
				dbCredentials.password = vcapServices[vcapService][0].credentials.password;
				dbCredentials.url = vcapServices[vcapService][0].credentials.url;
				
				cloudant = require('cloudant')(dbCredentials.url);
				
				// check if DB exists if not create
				cloudant.db.create(dbCredentials.dbName, function (err, res) {
					if (err) { console.log('could not create db ', err); }
				});
				
				db = cloudant.use(dbCredentials.dbName);
				break;
			}
		}
		if(db==null){
			console.warn('Could not find Cloudant credentials in VCAP_SERVICES environment variable - data will be unavailable to the UI');
		}
	} else{
		console.warn('VCAP_SERVICES environment variable not set - data will be unavailable to the UI');
		// For running this app locally you can get your Cloudant credentials 
		// from Bluemix (VCAP_SERVICES in "cf env" output or the Environment 
		// Variables section for an app in the Bluemix console dashboard).
		// Alternately you could point to a local database here instead of a 
		// Bluemix service.
		//dbCredentials.host = "REPLACE ME";
		//dbCredentials.port = REPLACE ME;
		//dbCredentials.user = "REPLACE ME";
		//dbCredentials.password = "REPLACE ME";
		//dbCredentials.url = "REPLACE ME";
	}
}

initDBConnection();

app.get('/', routes.index);

/********************************************/
var createDocument = function(email, event, place, first_name, last_name, callback) {
	console.log("Creating document for user " + email);

	db.insert({_id:email + " " + event + " " + place, event:event, place:place, first_name:first_name, last_name:last_name, email:email}, function(err, data) {
		console.log("Error: ", err);
		console.log("Data: ", data);
		callback(err, data);
	});
};

app.post('/add_event', function(req, res) {
	var Event=req.body.event.toLowerCase();
	var Place=req.body.place.toLowerCase();
	var First_Name=req.body.first_name;
	var Last_Name=req.body.last_name;
	var Email=req.body.email;
	db.find({selector:{_id:Email + " " + Event + " " + Place}}, function(err, result) {
		if(err) {
			console.log("Error to find the event");
			return 500;
		} else if(result.docs.length !== 0) {
			res.send("Event: " + Event + " for email " + Email + " at place " + Place + " already exists");
			return 200;
		}
		createDocument(Email, Event, Place, First_Name, Last_Name, function(err, data) {
		if(err) {
			console.log(err);
			return 500;
		}
		console.log("Add Success");
		var all_users_this_event = "User information:\n";
		db.find({selector:{_id:{$gt:0},event:Event}}, function(err, result) {
			if(err) {
				console.log("Find document error: ", err);
				res.send("Error when add Event: " + Event + " for email " + Email);
				return 500;
			}
			
	 		for(var index = 0; index < result.docs.length; ++index) {
				var cur_event = result.docs[index].event;
				var cur_place = result.docs[index].place;
				var cur_first_name = result.docs[index].first_name;
				var cur_last_name = result.docs[index].last_name;
				var cur_email = result.docs[index].email;
				all_users_this_event = all_users_this_event.concat(cur_event, ", ", cur_place, ", ", cur_first_name, " ", cur_last_name, ", ", cur_email, "\n");
			}
			
			for(var index = 0; index < result.docs.length; ++index) {
				smtpTransport.sendMail({
					from: "do.not.reply.teamup",
					to: result.docs[index].email,
					subject: "Waiting users for event " + result.docs[index].event,
					text: all_users_this_event.concat("New added user: ", Email)
				}, function(err, res) {
					if(err) {
						console.log("Error: ", err);
					} else {
						console.log("Message sent: " + res.messgae);
					}
				});
			}
			res.send("Event: " + Event + " added successfully for email " + Email);
		});
		return 200;
	});
	});
});

app.get('/get_event_for_email', function(req, res) {
	var key = req.query.key;
	
	var Email=req.query.email.toLowerCase();
	
	console.log("Search events for user ", Email);
	console.log("Reading document for user " + Email);
	db.find({selector:{_id:{$gt:0},email:Email}}, function(err, result) {
		if(err) {
			console.log("Find document error: ", err);
			return 500;
		}
		console.log("Successfully found all the events for email: " + Email);
		res.status(200);
        res.setHeader("Content-Disposition", 'inline; filename="' + key + '"');
		for(var index = 0; index < result.docs.length; ++index) {
			res.write(result.docs[index].event + ", ");
			res.write(result.docs[index].place + ", ");
			res.write(result.docs[index].email);
			res.write("\n");
		}
        res.end();
        return 200;
	});
});	

app.get('/get_email_for_event', function(req, res) {
	var key = req.query.key;
	
	var Event=req.query.event.toLowerCase();
	console.log("Search users for event ", Event);
	console.log("Reading document for event " + Event);
	db.find({selector:{_id:{$gt:0},event:Event}}, function(err, result) {
		if(err) {
			console.log("Find document error: ", err);
			res.status(500);
        	res.setHeader("Content-Disposition", 'inline; filename="' + key + '"');
        	res.write("Error when get email list for event " + Event);
        	res.end();
			return 500;
		}
		
		console.log("Successfully found all the users for event: " + Event);
		res.status(200);
        res.setHeader("Content-Disposition", 'inline; filename="' + key + '"');
        if(result.docs.length > 0) {
	        for(var index = 0; index < result.docs.length; ++index) {
				res.write(result.docs[index].event + ", ");
				res.write(result.docs[index].place + ", ");
				res.write(result.docs[index].first_name + " " +result.docs[index].last_name + ", ");
				res.write(result.docs[index].email);
				res.write("\n");
			}
		} else res.write("No emails found for event " + Event);
        res.end();
        return 200;
	});
});	

app.post('/delete_event_for_email', function(req, res) {
	var Email = req.body.email;
	var Event = req.body.event;
	var Place = req.body.place;
	db.find({selector:{_id:Email+" "+Event + " " + Place}}, function(err, result) {
		if(err) {
			res.send("Error when find event " + Event + " for email " + Email);
			return 500;
		}
		if(result.docs.length === 0) {
			res.send("No Event: " + Event + " found for email " + Email);
			return 200;
		}
		db.destroy(result.docs[0]._id, result.docs[0]._rev, function(err, data) {
			if(err) {
				res.send("Error when delete the event " + Event + " for email " + Email);
				return 500;
			}
			res.send("Event: " + Event + " deleted for email " + Email);
			return 200;
		});
	});
});

app.post('/delete_all_events_for_email', function(req, res) {
	var Email = req.body.email;
	var key = req.ruqey.key;
	
	db.find({selector:{_id:{$gt:0}}, email:Email}, function(err, result) {
		if(err) {
			res.send("Error when find events for email: " + Email);
			return 500;
		}
		if(result.docs.length === 0) {
			res.send("No event found for email " + Email);
			return 200;
		}
		res.status(200);
        res.setHeader("Content-Disposition", 'inline; filename="' + key + '"');
        
		for(var index = 0; index < result.docs.length; ++index) {
			db.destroy(result.docs[index]._id, result.docs[index]._rev, function(err, data) {
				if(err) {
					res.send("Error when delete Event :" + result.docs[index].event);
					return 500;
				}
				res.write("Event: " + result.docs[index].event + " at place " + result.docs[index].place + " has been deleted \n");
			});
		}
		res.end();
		return 200;
	});
});

http.createServer(app).listen(app.get('port'), '0.0.0.0', function() {
	console.log('Express server listening on port ' + app.get('port'));
});

