k = Kit('crowd', 5)
W=18.0; N=19
k.box(W+0.4, 1.3, 0.35, (0,-1.5,-0.3), '#2a3350')
for i in range(1,4):
    k.box(W+0.4, 1.0, 0.75*i+0.8+0.3, (0,-1.5+i*1.0+0.15,-0.3), '#1f2a4d' if i%2 else '#2a3766')
    k.box(W+0.4, 0.06, 0.22, (0,-1.5+i*1.0-0.36,0.75*i+0.5), ['#ffd21f','#e8372c','#f4f4ee'][i-1])
for i in range(4):
    for j in range(N):
        x=-8.6+j*0.94+(0.47 if i%2 else 0)-0.2+k.rnd.uniform(-0.12,0.12)
        y=-1.5+i*1.0+k.rnd.uniform(-0.1,0.1)
        if i==0: person(k,x,y,0.05,mode='stand',arms=k.rnd.random()<0.25)
        else: person(k,x,y+0.2,0.75*i+0.8,mode='bust',arms=k.rnd.random()<0.18)
SG=['#ffd21f','#f4f4ee','#ff5fa8','#19c2b8']
for q,(x,i) in enumerate(((-6.2,1),(1.1,2),(6.9,1))):
    y=-1.5+i*1.0+0.05; z=0.75*i+0.8+0.5
    k.strut((x,y,z),(x,y,z+1.25),0.035,'#e9e2c8',seg=3)
    k.box(1.3,0.05,0.75,(x,y-0.03,z+0.9),SG[q],rz=k.rnd.uniform(-0.15,0.15))
    k.box(0.8,0.03,0.2,(x,y-0.07,z+1.2),'#e8372c' if q%2 else '#2f7fe8')
R = k.done()
