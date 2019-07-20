var spawn = require('child_process').spawn;
var mergeJSON = require("merge-json");
var kill  = require('tree-kill');

var avstreamerConf = {
  videoDriver: 'v4l2',
  videoframeRate: '6',
  videoframeSize: '320x240',
  videoDeviceId: '/dev/video0',
  videoOutQuality: '10',
  videoOutCodec: 'mjpeg',
  videoRecordingCodec: 'h264_omx', //hardware assisted encoding , fast! 
  audioDriver: 'alsa',
  audioChannels: '1',
  audioInBitrate: '11025',
  audioDeviceId: 'hw:1,0',
  audioOutCodec: 'libmp3lame',
  audioOutBitrate: '32k',
  audioRecordingCodec: 'copy', //copy input encoding saves on CPU
  ffserverAudioIn: 'http://localhost:8090/webcamsound.ffm',
  ffserverVideoIn: 'http://localhost:8090/webcamvid.ffm',
  ffServerAudioOut: 'http://localhost:8090/webcamsound.mp3',
  ffserverVideoOut: 'http://localhost:8090/webcamvid.mjpeg',
  recordingTime: 60, // time to record in seconds 
  recordingFormat: 'matroska',
  recordingFolder: '/home/pi/pirov2/recordings', // where the recorded videos will saved, with reference to current directory need to manually create it
  recordingHoldTime: 10, // to keep the recordings in above folder in minutes
  //EventNames
  startRecordEvent: 'record',
  recordingDoneEvent: 'recordingdone',
  recordingErrEvent: 'recordingErr'
}

module.exports = function(config){
    config = config || {};
    //Module initialization
    //Merge default settings with supplied settingscd 
    var cfg = mergeJSON.merge(avstreamerConf, config);
    var isStreaming = false;
    var isRecording = false;
    var currRecordingSockId = 0;
    var viewerCount = 0;
    var ffServerHandl = null;
    var ffMpegHandl = null;
    var ffMpegRecordingHandl = null;
    var ffMpegStreamingParams = [ '-override_ffserver', 
                                  '-thread_queue_size', '2048',
                                  '-f', cfg.videoDriver, 
                                  '-r', cfg.videoframeRate, 
                                  '-s', cfg.videoframeSize, 
                                  '-i', cfg.videoDeviceId, 
                                  '-f', cfg.audioDriver, 
                                  '-thread_queue_size', '2048',
                                  '-ac', cfg.audioChannels, 
                                  '-ar', cfg.audioInBitrate, 
                                  '-i', cfg.audioDeviceId, 
                                  '-map', '1:a', 
                                  '-c:a', cfg.audioOutCodec, 
                                  '-b:a', cfg.audioOutBitrate, cfg.ffserverAudioIn, 
                                  '-map', '0:v', 
                                  '-q', cfg.videoOutQuality, 
                                  '-c:v', cfg.videoOutCodec, cfg.ffserverVideoIn 
                                ].join(" ");
    // Clean up function runs every 10 seconds
    setInterval(() => {
      if(isStreaming && viewerCount===0){
        isStreaming = false;
        kill(ffMpegHandl.pid);
        kill(ffServerHandl.pid);
        console.log("Killing av server");
      }
      //Recording folder cleanup
      console.log('File Cleanup in progress ...');
      spawn("find "+ cfg.recordingFolder +"  -type f -mmin +" + cfg.recordingHoldTime +" -exec rm -rf {} +", {stdio: 'inherit', shell: true});
      console.log('File Cleanup done.');
    }, 10000);
    //Module initialization
    streamingFunc = function(socket){
      console.log("avstreamer connected to " + socket.conn.id);
      // This is done when new user is connected
      viewerCount++;
      if(!isStreaming){
        isStreaming = true;
        ffServerHandl = spawn('ffserver',{stdio: 'inherit', shell: true});
        setTimeout(() => {ffMpegHandl = spawn('ffmpeg ' + ffMpegStreamingParams, {stdio: 'inherit', shell: true});}, 5000);
      }

      socket.on('disconnect', function(){
        viewerCount--;
        if(isRecording && currRecordingSockId===socket.conn.id){
          isRecording = false;
          currRecordingSockId = 0;
          //stop recording
          kill(ffMpegRecordingHandl.pid);
        }
      });

      socket.on(cfg.startRecordEvent, function(data){
        if(!isRecording){
          isRecording = true;
          currRecordingSockId = socket.conn.id;
          var ffMpegRecordingParams = [ '-i', cfg.ffServerAudioOut, 
                                      '-i', cfg.ffserverVideoOut, 
                                      '-filter:v', '"setpts=4.58*PTS"',
                                      '-c:a', cfg.audioRecordingCodec, 
                                      '-c:v', cfg.videoRecordingCodec, 
                                      '-q', cfg.videoOutQuality, 
                                      '-s', cfg.videoframeSize,
                                      '-f', cfg.recordingFormat,
                                      '-t', cfg.recordingTime,
                                      '-y', currRecordingSockId+".mkv"
                                    ].join(" ");
          ffMpegRecordingHandl = spawn('ffmpeg ' + ffMpegRecordingParams, {stdio: 'inherit', shell: true, cwd: cfg.recordingFolder});
          ffMpegRecordingHandl.on('exit', function (code) {
            if (code === 0){
              console.log('Recording Completed for ' + currRecordingSockId);
              var filename = currRecordingSockId + ".mkv";
              socket.emit(cfg.recordingDoneEvent,{recording:false, success:true, filename:filename});
              currRecordingSockId = null;
              isRecording = false;
            }
            else{
              currRecordingSockId = null;
              isRecording = false;
              socket.emit(cfg.recordingErrEvent,{recording: isRecording, success:false, error: "Some error occured"});
            }
          });
          socket.emit(cfg.recordingErrEvent,{recording: isRecording, success:true, error: "current recording for " + currRecordingSockId});
        }
        else{
          socket.emit(cfg.recordingErrEvent,{recording: isRecording, success:false, error: "current recording for " + currRecordingSockId});
        }
      });
    }
    return streamingFunc
};