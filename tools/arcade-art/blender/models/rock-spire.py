k = Kit('rock-spire', 107)
BAND=['#b98a62','#c99a6e','#a87850','#d6ae84','#9c6c48','#c08e62','#b98a62','#8f6040']
k.cyl(7.5,1.4,(0,0,-1.0),'#9c6c48',seg=10,r2=6.0,fj=0.08)
def spire(x,y,R,H,seed,segs=8,rings=11):
    def P(u,v):
        a=2*pi*u; r=R*(1-0.72*v**0.8)*(1+0.22*fbm((cos(a)*2,sin(a)*2,v*5),1.0,2,seed))*(1.0+0.12*sin(v*23+seed))
        return (x+r*cos(a)+0.6*sin(v*3+seed)*v, y+r*sin(a), -0.3+H*v)
    fs=k.sheet(P,segs,rings,BAND[0],fj=0.05)
    k.tint(fs, lambda c,n: BAND[int(c.z/1.25+fbm((c.x*0.2,c.y*0.2,0),1,2,seed)*1.2)%len(BAND)])
    top=(x+0.6*sin(3+seed),y)
    k.rock(R*0.42,(top[0],top[1],H-0.3),'#8f6040',sub=1,sc=(1.15,1.15,0.6),amp=0.2)
    k.rock(R*0.3,(top[0],top[1],H+R*0.22),'#5fa83a',sub=1,sc=(1.1,1.1,0.55),amp=0.2)
spire(0,0.5,4.2,25.0,3.0,9,12); spire(-4.6,-1.5,2.9,16.5,9.0); spire(4.4,-0.8,2.4,11.5,17.0,7,9); spire(1.5,3.6,2.0,8.0,23.0,7,7)
for i in range(7):
    a=i*0.9+0.3
    k.rock(1.0+k.rnd.random()*1.2,(6.2*cos(a),6.2*sin(a),0.3),BAND[i%6],sub=1,sc=(1.2,1,0.7))
for (x,y) in ((-6.5,-3.5),(6.0,-4.0),(2.5,-5.5)):
    k.cyl(0.5,1.2,(x,y,0.0),'#3f9a45',seg=5,r2=0.35,fj=0.1); k.cyl(0.3,0.7,(x+0.6,y,0.3),'#3f9a45',seg=5,fj=0.1)
R = k.done()
