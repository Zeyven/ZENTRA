// Reconstructed from field tags and writeField code in the supplied executable.
// Field IDs/types verified statically; real-device interoperability is pending.
struct TRpcRequest {
  1: string url,
  2: map<string,string> head,
  3: binary body
}
struct TRpcResponse {
  1: i32 exstatus,
  2: string exmsg,
  3: map<string,string> head,
  4: binary data
}
service TRpcService {
  oneway void OnAskCall(1:i32 ask_id, 2:TRpcRequest request),
  oneway void OnAnsweCall(1:i32 ask_id, 2:TRpcResponse response)
}
