k = Kit('mesa', 123)
BAND=['#c8553a','#d2643c','#dd7a4a','#b8472f','#e3a070','#cf5e3a','#c8553a','#a84530']
def butte(x,y,R,H,seed,segs=14,rings=9):
    def P(u,v):
        a=2*pi*u; e=1+0.25*fbm((cos(a)*1.5,sin(a)*1.5,seed),1.0,3,seed)
        r=R*e*(1.0+0.75*(1-min(1,v/0.42))**1.7)*(1.0-0.05*max(0,v-0.42))
        return (x+r*cos(a)*1.25,y+r*sin(a),-1.5+(H+1.5)*v)
    fs=k.sheet(P,segs,rings,BAND[0],fj=0.05)
    k.tint(fs, lambda c,n: BAND[int(c.z/2.1+fbm((c.x*0.05,c.y*0.05,1),1,2,seed))%len(BAND)])
    k.poly([P(u/segs,1.0) for u in range(segs)],'#e0b98a')
    for i in range(5):
        a=i*1.3+seed; k.rock(R*0.09+0.6,(x+R*0.5*cos(a)*1.2,y+R*0.5*sin(a),H+0.2),'#6fae5a' if i%2 else '#b8472f',sub=1,sc=(1.3,1.2,0.6))
butte(0,2,22,39,2.0,16,10); butte(-30,-6,9,24,7.0,10,7); butte(27,-9,6.5,15,13.0,9,6)
for i in range(12):
    a=i*0.55; k.rock(2.0+k.rnd.random()*2.5,(40*cos(a),4+30*sin(a),0.0),BAND[i%6],sub=1,sc=(1.3,1.1,0.7))
k.floor=-1.5
R = k.done()
