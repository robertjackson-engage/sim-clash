k = Kit('lava-fall', 103)
falls(k, ['#3d3230','#2c2524','#4a3c38'], None, ['#ffb21f','#ff5a12','#ffe04a','#ff7a1a'], True, '#ff5a12', '#ffd84a', crack='#ff6a1a')
for (x,y,z,h) in ((-9.5,9,28.0,4.5),(8.5,9.5,28.2,3.6),(11.5,7,21.3,3.0)):
    k.strut((x,y,z-0.5),(x+0.5,y,z+h),0.3,'#1c1716',seg=5,r2=0.08,cap=True)
    k.strut((x+0.2,y,z+h*0.5),(x+1.4,y+0.3,z+h*0.85),0.14,'#1c1716',seg=4,r2=0.05,cap=True)
    k.strut((x+0.3,y,z+h*0.65),(x-0.9,y-0.2,z+h*0.95),0.12,'#1c1716',seg=4,r2=0.05,cap=True)
for i in range(14):
    k.sph(0.22+k.rnd.random()*0.2,(k.rnd.uniform(-9,9),k.rnd.uniform(-6,3),2+k.rnd.random()*20),'#ffd84a',sub=1,glow=1)
k.floor = -1.5
R = k.done()
