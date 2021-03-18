"use strict";
exports.handler = async (event, context, callback) => {
    var _a;
    console.log('Event Received');
    console.log(JSON.stringify(event));
    let records = event.Records;
    for (let index in records) {
        let message = (_a = records[index]) === null || _a === void 0 ? void 0 : _a.Sns.Message;
        if (message == 'please fail') {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVzdGluZWRMYW1iZGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkZXN0aW5lZExhbWJkYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQ0EsT0FBTyxDQUFDLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBUyxFQUFFLE9BQVcsRUFBRSxRQUFZLEVBQUUsRUFBRTs7SUFDL0QsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO0lBQzdCLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBRW5DLElBQUksT0FBTyxHQUFVLEtBQUssQ0FBQyxPQUFPLENBQUM7SUFFcEMsS0FBSSxJQUFJLEtBQUssSUFBSSxPQUFPLEVBQUU7UUFDdkIsSUFBSSxPQUFPLFNBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQywwQ0FBRSxHQUFHLENBQUMsT0FBTyxDQUFDO1FBQzFDLElBQUcsT0FBTyxJQUFJLGFBQWEsRUFBQztZQUMxQixPQUFPLENBQUMsR0FBRyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7WUFDckQsTUFBTSxJQUFJLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztTQUN6QjtLQUNGO0lBRUQsT0FBTztRQUNMLE1BQU0sRUFBRSxpQ0FBaUM7UUFDekMsTUFBTSxFQUFFLFNBQVM7UUFDakIsT0FBTyxFQUFFLGFBQWE7S0FDdkIsQ0FBQztBQUNKLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIlxuZXhwb3J0cy5oYW5kbGVyID0gYXN5bmMgKGV2ZW50OmFueSwgY29udGV4dDphbnksIGNhbGxiYWNrOmFueSkgPT4ge1xuICBjb25zb2xlLmxvZygnRXZlbnQgUmVjZWl2ZWQnKVxuICBjb25zb2xlLmxvZyhKU09OLnN0cmluZ2lmeShldmVudCkpO1xuXG4gIGxldCByZWNvcmRzOiBhbnlbXSA9IGV2ZW50LlJlY29yZHM7XG5cbiBmb3IobGV0IGluZGV4IGluIHJlY29yZHMpIHtcbiAgICBsZXQgbWVzc2FnZSA9IHJlY29yZHNbaW5kZXhdPy5TbnMuTWVzc2FnZTtcbiAgICBpZihtZXNzYWdlID09ICdwbGVhc2UgZmFpbCcpe1xuICAgICAgY29uc29sZS5sb2coJ3JlY2VpdmVkIGZhaWx1cmUgZmxhZywgdGhyb3dpbmcgZXJyb3InKTtcbiAgICAgIHRocm93IG5ldyBFcnJvcigndGVzdCcpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc291cmNlOiAnY2RrcGF0dGVybnMudGhlLWRlc3RpbmVkLWxhbWJkYScsXG4gICAgYWN0aW9uOiAnbWVzc2FnZScsXG4gICAgbWVzc2FnZTogJ2hlbGxvIHdvcmxkJ1xuICB9O1xufTsiXX0=