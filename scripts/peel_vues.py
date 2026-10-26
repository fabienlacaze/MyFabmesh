# -*- coding: utf-8 -*-
"""Pelage de profondeur (2 couches) : z1 = surface la plus proche, z2 = la plus proche au-dela de z1 + e0. Sert detect_vues.py."""
import numpy as np
from numba import njit

@njit(cache=False,nogil=True)
def _tri(X,Y,Z,F,f,R,mode,zb1,fid1,zb2,e0):
    ia,ib,ic=F[f,0],F[f,1],F[f,2]
    xa,xb,xc=X[ia],X[ib],X[ic]; ya,yb,yc=Y[ia],Y[ib],Y[ic]
    x0=int(np.floor(min(xa,xb,xc)));x1=int(np.floor(max(xa,xb,xc)))
    y0=int(np.floor(min(ya,yb,yc)));y1=int(np.floor(max(ya,yb,yc)))
    if x1<0 or y1<0 or x0>=R or y0>=R: return
    den=(yb-yc)*(xa-xc)+(xc-xb)*(ya-yc)
    if abs(den)<1e-12: return
    x0=max(x0,0);y0=max(y0,0);x1=min(x1,R-1);y1=min(y1,R-1)
    for y in range(y0,y1+1):
        for x in range(x0,x1+1):
            px=x+0.5;py=y+0.5
            l1=((yb-yc)*(px-xc)+(xc-xb)*(py-yc))/den
            l2=((yc-ya)*(px-xc)+(xa-xc)*(py-yc))/den
            l3=1.0-l1-l2
            if l1>=-1e-9 and l2>=-1e-9 and l3>=-1e-9:
                z=l1*Z[ia]+l2*Z[ib]+l3*Z[ic]
                if mode==0:
                    if z<zb1[y,x]:
                        zb1[y,x]=z;fid1[y,x]=f
                else:
                    if z>zb1[y,x]+e0 and z<zb2[y,x]:
                        zb2[y,x]=z

@njit(cache=False,nogil=True)
def raster_pass(X,Y,Z,F,R,mode,zb1,fid1,zb2,e0):
    for f in range(F.shape[0]):
        _tri(X,Y,Z,F,f,R,mode,zb1,fid1,zb2,e0)

def peel(V,F,d,R,c,diag,e0rel=5e-4):
    import bouchage_peau as bp
    d=np.asarray(d,float);d/=np.linalg.norm(d)
    a,b=bp._base(d)
    s=R/(diag*1.02)
    X=(V-c)@a*s+R/2;Y=(V-c)@b*s+R/2;Z=(V-c)@d
    zb1=np.full((R,R),np.inf);fid1=np.full((R,R),-1,np.int32);zb2=np.full((R,R),np.inf)
    Fc=np.ascontiguousarray(F)
    raster_pass(X,Y,Z,Fc,R,0,zb1,fid1,zb2,0.0)
    raster_pass(X,Y,Z,Fc,R,1,zb1,fid1,zb2,e0rel*diag)
    return fid1,zb1,zb2,(a,b,d,c,s)
