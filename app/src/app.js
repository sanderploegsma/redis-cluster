const Redis = require('ioredis');
const { Observable } = require('rxjs');

const cluster = new Redis.Cluster([
  {
    port: 6379,
    host: 'redis-cluster'
  }
]);

cluster.on('connect', () => console.log('Cluster connected'));
cluster.on('reconnecting', () => console.log('Cluster reconnecting'));
cluster.on('error', err => console.log(`Cluster error: ${err.lastNodeError}`));

const initial = "abcdefghijklmnopqrstuvwxyz".split("");

cluster.on('ready', () => {
  console.log('Cluster ready, starting loop!');
  // Retrieve a key each second
  const getKeyOnInterval$ = Observable
    .interval(1000)
    .flatMap(i => Observable.of(i % 26)
      .flatMap(i => cluster.get(initial[i]))
      .mapTo('success')
      .catch(err => Observable.of('failure'))
    )

  const fillCluster = () => Promise.all(initial.map(x => cluster.set(x, x)));

  Observable.defer(fillCluster)
    .ignoreElements()
    .concat(getKeyOnInterval$)
    .subscribe(
      x => console.log(`${new Date().toTimeString()}: ${x}`),
      err => console.log(`Error in loop: ${err.message}`)
    );
});