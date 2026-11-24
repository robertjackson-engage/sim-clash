k = Kit('lava-rock', 131)
RC=['#3d3230','#2c2524','#4a3c38']
def lr(r,at,sc,sub=2):
    fs=k.rock(r,at,RC[k.rnd.randint(0,2)],sub=sub,sc=sc,amp=0.32,fj=0.1)
    k.tint(fs, lambda c,n: (('#ff6a1a','#ffb21f')[k.rnd.randint(0,1)],1) if k.rnd.random()<0.13 else None)
lr(2.6,(0,0.3,1.6),(1.2,1.0,1.25),3); lr(1.9,(-2.4,-0.6,0.9),(1.1,1.0,1.0)); lr(1.6,(2.3,-0.4,0.8),(1.0,1.1,1.1)); lr(1.2,(0.6,-2.2,0.4),(1.2,1.0,0.8)); lr(1.3,(0.4,1.0,4.0),(0.9,0.9,1.0))
k.lathe([(4.2,-0.4),(4.2,0.1),(0,0.1)],10,col='#2c2524',fj=0.08)
k.lathe([(1.5,0.16),(0,0.16)],8,col='#ff7a1a',m=T(-0.9,-2.6,0)@S(1.3,0.8,1),glow=1); k.lathe([(0.8,0.2),(0,0.2)],7,col='#ffd84a',m=T(-0.9,-2.6,0),glow=1)
for i in range(4): k.sph(0.12,(k.rnd.uniform(-2,2),k.rnd.uniform(-2.5,0),2+k.rnd.random()*3),'#ffd84a',sub=1,glow=1)
k.floor=-0.5
R = k.done()
