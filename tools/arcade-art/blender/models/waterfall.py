k = Kit('waterfall', 101)
falls(k, ['#8d8272','#a39884','#75695a'], '#5fb040', ['#e4f8ff','#a8e4ff','#f6fdff','#7fd4f7'], False, '#2fb5e8', '#f4fdff')
for (x,y,z,h) in ((-9.5,9,28.2,4.2),(-6.2,10.5,28.6,3.2),(8.5,9.5,28.4,4.6),(11,7,21.5,3.4),(-12,6.5,21.2,3.0),(5.8,11,29.0,2.8)):
    k.cyl(0.25,h*0.4,(x,y,z-0.3),'#7d4d28',seg=5)
    k.cyl(h*0.36,h*0.5,(x,y,z+h*0.25),'#2f9a3a',seg=7,r2=0,fj=0.1); k.cyl(h*0.27,h*0.45,(x,y,z+h*0.55),'#3fb548',seg=7,r2=0,fj=0.1)
for i in range(10):
    a=k.rnd.uniform(0,pi); r=12+k.rnd.random()*3
    k.rock(1.0+k.rnd.random(),(r*cos(a),2+r*sin(a)*0.6,1.0+k.rnd.random()*3),'#4fa83a',sub=1,sc=(1.2,1.2,0.8),fj=0.12)
k.floor = -1.5
R = k.done()
