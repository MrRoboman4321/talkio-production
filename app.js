var express = require('express'); 
var socketio = require('socket.io');
var bcrypt = require('bcrypt-nodejs');
var fs = require('fs');
var logger = require('tracer').colorConsole( //Automagically add the time format before each message, no matter the type
	{
		format : [
		    timeFormat() + " {{message}} (in {{file}}:{{line}})"
		]
	});

var fs = require('fs');
var file = 'db.sqlite';
var dbexists = fs.existsSync(file);
console.log(dbexists);
var sqlite = require('sqlite3').verbose();
var db = new sqlite.Database(file);

//fixes issue with db commands not executing in the right order
db.serialize(function(){
	if(!dbexists) {
		db.run("CREATE TABLE users (user TEXT, pass TEXT, email TEXT, level INTEGER)");
		db.run("CREATE TABLE rooms (name TEXT, owner TEXT, mods TEXT, private BOOL, messages TEXT, topic TEXT, lang BOOL, autoplay BOOL)");
		db.run("CREATE TABLE sessions (user TEXT, token TEXT)");
	}
	db.run("DELETE FROM sessions");
});


var app = express();

var server = app.listen(3001);
var io = socketio.listen(server);

var users = [];
var userTokens = [];
var persistantUsers = [];
var sockets = [];

logger.warn("App started!");

io.on('connection', function(socket) {
	socket.on('register', function(data) {
		register(data, socket);
	});
	socket.on('loginToken', function(data) { //IMPLEMENTED
		token = userTokens[userTokens.indexOf(data.token)];
		logger.info(token);
		if(typeof token == 'undefined') {
			socket.emit('clearToken');
			db.serialize(function() {
				db.run("DELETE FROM sessions WHERE token = ?", [data.token]);
			});
		} else {
			logger.log(token);
			onLoggedIn(data, socket, "token");
		}
	});

	socket.on('loginNormal', function(data) { //IMPLEMENTED
		login(data.username, data.password, socket);
	});

	socket.on('logout', function() {
		logout(socket);
	});

	socket.on('disconnect', function() {
		disconnect(socket);
	});
})

app.get('/', function(req, res) {
	res.sendFile(__dirname + '/index.html');
});

app.get('/stylesheet.css', function(req, res) {
	res.sendFile(__dirname + '/css/stylesheet.css');
});

app.get('/chat.js', function(req, res) {
	res.sendFile(__dirname + '/javascript/chat.js');
});

app.get('/cookie.js', function(req, res) {
	res.sendFile(__dirname + "/javascript/cookie.js");
});

function timeFormat() { //Nice time format
	d = new Date();
	return "[" + d.getHours().toString() + ":" + d.getMinutes().toString() + "] ";
}

function register(data, socket) { //DB calls to register a user
	if(data.username.length > 15) {
		socket.emit('registerError', {type: 'tooLong'});
		return;
	} else if(data.username == null || data.username == "" || data.password == null || data.password == "" || data.email == null || data.email == "") {
		socket.emit('registerError', {type: 'missing'});
		return;
	}	
	db.serialize(function(){
		db.get("SELECT rowid AS id FROM users WHERE name = ? COLLATE NOCASE", data.username, function(err, row){
			if(row != undefined) {
				socket.emit('registerError', {type: 'userTaken'});
				return;
			} 
			bcrypt.genSalt(10, function(err, salt) {
				bcrypt.hash(data.password, salt, null, function(err, res) {
				    db.run("INSERT INTO users VALUES (?, ?, ?, 1)", [data.username, res, data.email]);
				    socket.emit('registrationComplete'); //IMPLEMENTED
			    });
			});
	    });
	});

	onLoggedIn(data, socket, 'nonToken');
}

function login(username, pHash, socket) { //DB calls to login the user
	db.serialize(function() {
		db.get('SELECT * FROM users WHERE user = ?', [username], function(err, res) {
			if(typeof res == 'undefined') {
				socket.emit('loginError', {type: 'badUser'});
				return;
			} 

			bcrypt.compare(pHash, res.pass, function(err, same) {
				if(!same) {
					socket.emit('loginError', {type: 'badPass'});
					return;
				}
				onLoggedIn({username: username}, socket, 'nonToken');
			});
		});
	});
}

function onLoggedIn(data, socket, type) { //Equivelant of old socket.on('login')
	var token = genNewToken();
	if(type == 'nonToken') {
		db.serialize(function() {
			socket.emit('token', {token: token}); //IMPLEMENTED
			db.run("INSERT INTO sessions VALUES (?, ?)", [data.username, token]);
			userTokens.push(token);
			persistantUsers.push(data.username);
		});
	} else {
		logger.log(userTokens);
		logger.log(persistantUsers);
		nameindex = userTokens.indexOf(data.token);
		data.username = persistantUsers[nameindex];
		logger.log(data.username);
	}
	socket.emit('loggedIn', {username: data.username});
	for(var i = 0; i<users.length; i++) {
		socket.emit('newUser', {user: users[i]}); //IMPLEMENTED
	} 
	users.push(data.username);	sockets.push(socket);
	logger.info("Users: " + users.toString());
	io.sockets.emit('newUser', {user: data.username}); //IMPLEMENTED
	logger.info("A user connected!");

	socket.on('recording', function(data) {
		tokenID = userTokens.indexOf(data.token);
		if(tokenID == -1) {
			logout(socket, token);
		} else {
		    io.sockets.emit('userRecording', {user: persistantUsers[userTokens.indexOf(data.token)]}); //IMPLEMENTED
		}
	});

	socket.on('stoppedRecording', function(data) {
		tokenID = userTokens.indexOf(data.token);
		if(tokenID == -1) {
			logout(socket, token);
		} 
		io.sockets.emit('userNotRecording', {user: persistantUsers[userTokens.indexOf(data.token)]});
	});
	socket.on('blob', function(data) {
		tokenID = userTokens.indexOf(data.token);
		if(tokenID == -1) {
			logout(socket, token);
		} else {
		    io.sockets.emit('play', {username: persistantUsers[userTokens.indexOf(data.token)], blob: data.blob}); //IMPLEMENTED
		}
		logger.info(data.username);
    });
    socket.on('joinRoom', function(data) {

    });
}

function genNewToken() { //Gen token for message validation and session retention
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for( var i=0; i < 8; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

function logout(socket, token) { //If something is invalid about the session or the user clicks logout
	try {
		socket.emit('reload');
	} catch(e) {
		logger.warn(e);
	}
	index = sockets.indexOf(socket);
    sockets.splice(index, 1);
    io.sockets.emit('userLeft', {user: users[index]}); //IMPLEMENTED
    users.splice(index, 1);
    userTokens.splice(userTokens.indexOf(token), 1);
    persistantUsers.splice(userTokens.indexOf(token), 1);
    logger.info("A user logged out.");
    logger.info("Users: " + users.toString());
}

function disconnect(socket) {
	socket.emit('reload');
	index = sockets.indexOf(socket);
	sockets.splice(index, 1);
	io.sockets.emit('userLeft', {user: users[index]});
	users.splice(index, 1);
	logger.info("A user disconnected");
    logger.info("Users: " + users.toString());
}