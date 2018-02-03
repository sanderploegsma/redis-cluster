# Redis cluster
A [redis cluster](https://redis.io/topics/cluster-tutorial) running in Kubernetes. The docker image embeds the `redis-trib.rb` used in the tutorial as a `redis-trib` binary in the container's PATH for convenience.

If the cluster configuration of a redis node is lost in some way, it will come back with a different ID, which upsets the balance in the cluster (and probably in the Force). To prevent this, the setup uses a combination of Kubernetes StatefulSets and PersistentVolumeClaims to make sure the state of the cluster is maintained after rescheduling or failures.

## Setup (using minikube)
1. `minikube start`
2. `eval $(minikube docker-env)`
3. `docker build -t redis-cluster:v1 .`
4. `kubectl apply -f redis-cluster.yml`

This will spin up 6 `redis-cluster` pods one by one, which may take a while. After all pods are in a running state, you can itialize the cluster using the `redis-trib` command in any of the pods. After the initialization, you will end up with 3 master and 3 slave nodes.
``` bash
kubectl exec -it redis-cluster-0 -- redis-trib create --replicas 1 \
$(kubectl get pods -l app=redis-cluster -o jsonpath='{range.items[*]}{.status.podIP}:6379 ')
```

## Adding nodes
Adding nodes to the cluster involves a few manual steps. First, let's add two nodes:
``` bash
kubectl scale statefulset redis-cluster --replicas=8
```

Have the first new node join the cluster as master:
``` bash
kubectl exec redis-cluster-0 -- redis-trib add-node \
$(kubectl get pod redis-cluster-6 -o jsonpath='{.status.podIP}'):6379 \
$(kubectl get pod redis-cluster-0 -o jsonpath='{.status.podIP}'):6379
```

The second new node should join the cluster as slave. This will automatically bind to the master with the least slaves (in this case, `redis-cluster-6`)
``` bash
kubectl exec redis-cluster-0 -- redis-trib add-node --slave \
$(kubectl get pod redis-cluster-7 -o jsonpath='{.status.podIP}'):6379 \
$(kubectl get pod redis-cluster-0 -o jsonpath='{.status.podIP}'):6379
```

Finally, automatically rebalance the masters:
``` bash
kubectl exec redis-cluster-0 -- redis-trib rebalance --use-empty-masters \
$(kubectl get pod redis-cluster-0 -o jsonpath='{.status.podIP}'):6379
```

## Removing nodes

### Removing slaves
Slaves can be deleted safely. First, let's get the id of the slave:

``` bash
$ kubectl exec redis-cluster-7 -- redis-cli cluster nodes | grep myself
3f7cbc0a7e0720e37fcb63a81dc6e2bf738c3acf 172.17.0.11:6379 myself,slave 32f250e02451352e561919674b8b705aef4dbdc6 0 0 0 connected
```

Then delete it:
``` bash
kubectl exec redis-cluster-0 -- redis-trib del-node \
$(kubectl get pod redis-cluster-0 -o jsonpath='{.status.podIP}'):6379 \
3f7cbc0a7e0720e37fcb63a81dc6e2bf738c3acf
```

### Removing a master
To remove master nodes from the cluster, we first have to move the slots used by them to the rest of the cluster, to avoid data loss.

First, take note of the id of the master node we are removing:
``` bash
$ kubectl exec redis-cluster-6 -- redis-cli cluster nodes | grep myself
27259a4ae75c616bbde2f8e8c6dfab2c173f2a1d 172.17.0.10:6379 myself,master - 0 0 9 connected 0-1364 5461-6826 10923-12287
```

Also note the id of any other master node:
``` bash
$ kubectl exec redis-cluster-6 -- redis-cli cluster nodes | grep master | grep -v myself
32f250e02451352e561919674b8b705aef4dbdc6 172.17.0.4:6379 master - 0 1495120400893 2 connected 6827-10922
2a42aec405aca15ec94a2470eadf1fbdd18e56c9 172.17.0.6:6379 master - 0 1495120398342 8 connected 12288-16383
0990136c9a9d2e48ac7b36cfadcd9dbe657b2a72 172.17.0.2:6379 master - 0 1495120401395 1 connected 1365-5460
```

Then, use the `redis-trib` `reshard` command to move all slots from `redis-cluster-6`:
``` bash
kubectl exec redis-cluster-0 -- redis-trib reshard --yes \
--from 27259a4ae75c616bbde2f8e8c6dfab2c173f2a1d \
--to 32f250e02451352e561919674b8b705aef4dbdc6 \
--slots 16384 \
$(kubectl get pod redis-cluster-0 -o jsonpath='{.status.podIP}'):6379
```

After resharding, it is safe to delete the `redis-cluster-6` master node:
``` bash
kubectl exec redis-cluster-0 -- redis-trib del-node \
$(kubectl get pod redis-cluster-0 -o jsonpath='{.status.podIP}'):6379 \
27259a4ae75c616bbde2f8e8c6dfab2c173f2a1d
```

Finally, we can rebalance the remaining masters to evenly distribute slots:
``` bash
kubectl exec redis-cluster-0 -- redis-trib rebalance --use-empty-masters \
$(kubectl get pod redis-cluster-0 -o jsonpath='{.status.podIP}'):6379
```

### Scaling down
After the master has been resharded and both nodes are removed from the cluster, it is safe to scale down the statefulset:
``` bash
kubectl scale statefulset redis-cluster --replicas=6
```

## Cleaning up
``` bash
kubectl delete pods,statefulset,svc,configmap,pvc -l app=redis-cluster
```
