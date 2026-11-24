k = Kit('pine', 111)
k.cyl(2.2,0.7,(0,0,-0.5),'#f7fbff',seg=9,r2=1.6)
k.cyl(0.55,4.0,(0,0,0),'#7d4d28',seg=7,r2=0.35,fj=0.08)
G1=['#1f7a3a','#27893f','#1a6b33']
for i in range(6):
    t=i/5; R=4.3-3.3*t; z=2.2+i*1.95
    skirtcone(k,R,z,R*0.25,z+2.9-0.9*t,9,G1[i%3],droop=0.5,jag=0.1,fj=0.1)
    skirtcone(k,R*0.72,z+1.45-0.3*t,R*0.14,z+3.3-0.9*t,9,'#f7fbff',droop=0.3,jag=0.16)
k.cyl(0.5,1.6,(0,0,13.2),'#f7fbff',seg=6,r2=0)
R = k.done()
