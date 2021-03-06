
exports.handler = async (event:any, context:any, callback:any) => {
  console.log('Event Received')
  console.log(JSON.stringify(event));

  let records: any[] = event.Records;

 for(let index in records) {
    let message = records[index]?.Sns.Message;
    if(message == 'please fail'){
      console.log('received failure flag, throwing error');
      throw new Error('test');
    }
  }

  return {
    source: 'cdkpatterns.the-destined-lambda',
    action: 'message',
    message: 'hello world'
  };
};