var express = require('express'); 
var socketio = require('socket.io');
var logger = require('tracer').colorConsole( //Automagically add the time format before each message, no matter the type
	{
		format : [
		    timeFormat() + " {{message}}"
		]
	});

var app = express();

var server = app.listen(3001);
var io = socketio.listen(server);

var users = [];
var sockets = [];

logger.warn("App started!");

io.on('connection', function(socket) {
	socket.emit("getUsername");
	socket.on('username', function(data) { //Will be changed to secure user login once implemented
		for(var i = 0; i<users.length; i++) {
			socket.emit('newUser', {user: users[i]});
		}
		users.push(data.username);
		sockets.push(socket);
		logger.info("Users: " + users.toString());
		io.sockets.emit('newUser', {user: data.username});

		socket.on('recording', function() {
			io.sockets.emit('userRecording', {user: data.username});
		});

		socket.on('stoppedRecording', function() {
			io.sockets.emit('userNotRecording', {user: data.username});
		});
		socket.on('blob', function(data) {
			logger.info(data.toString());
            io.sockets.emit('play', {from: data.username, blob: data.blob});
	    });
	});
	logger.info("A user connected!");

	socket.on('disconnect', function() {
         index = sockets.indexOf(socket);
         sockets.splice(index, 1);
         io.sockets.emit('userLeft', {user: users[index]});
         users.splice(index, 1);

         logger.info("A user disconnected.")
         logger.info("Users: " + users.toString());
	});
})

app.get('/', function(req, res) {
	res.sendFile(__dirname + '\\index.html');
});

app.get('/stylesheet.css', function(req, res) {
	res.sendFile(__dirname + '\\css\\stylesheet.css');
});

app.get('/chat.js', function(req, res) {
	res.sendFile(__dirname + '\\javascript\\chat.js');
});

function timeFormat() {
	d = new Date();
	return "[" + d.getHours().toString() + ":" + d.getMinutes().toString() + "] ";
}