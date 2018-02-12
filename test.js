const Airship = require('./dist').default;

//function payWithBitcoin() {
//  console.log('Sending payment with Bitcoin');
//  console.log('Congrats!!!!!!');
//}
//
//function notifyOfPaymentFailure() {
//  console.log('Sorry you cannot pay with Bitcoin at this time');
//  console.log('Goodbye');
//}

const tonyStark = {
  type: 'User',
  id: '1',
  display_name: 'tony@stark.com'
};

const nedStark = {
  type: 'User',
  id: '2',
  display_name: 'ned@stark.com'
};

const airship = new Airship({
  apiKey: '',
  environment: ''
});

Promise.all([
  airship.isEnabled('bitcoin-pay', tonyStark),
  airship.isEnabled('bitcoin-pay', nedStark),
  airship.isEnabled('bitcoin-pay', [tonyStark, nedStark]),
  airship.getVariation('calendar-sync', tonyStark),
  airship.getVariation('calendar-sync', nedStark),
  airship.getVariation('calendar-sync', [tonyStark, nedStark])
]).then(x => x.forEach(result => console.log(result)));

const customTonyStark = {
  user_id: 1,
  email: 'tony@stark.com'
};

const airship2 = new Airship({
  apiKey: '',
  environment: '',
  transformer: user => ({
    type: 'User',
    id: user.user_id.toString(),
    display_name: user.email
  })
});

airship2
  .getVariation('calendar-sync', customTonyStark)
  .then(result => console.log('Transformer:', result));
