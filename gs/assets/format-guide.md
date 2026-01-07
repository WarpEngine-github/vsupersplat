gs_example包含opencv坐标系下的静态高斯，从skeleton.pt，std_male.model.pt，body.obj解析出rest pose和骨骼层级关系
joints: (441, 3) - 关节位置数组
mu: (131072, 3) - 高斯球中心点 (Means)
cov: (131072, 3, 3) - 协方差矩阵
opacity: (131072,) - 不透明度
color: (131072, 3) - 颜色数据 (RGB)
W: (131072, 441) - 蒙皮权重矩阵 (Skinning weights)
其中poses是代表每帧的动作骨骼的旋转和位移数据