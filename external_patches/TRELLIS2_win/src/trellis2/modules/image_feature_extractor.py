from typing import *
import torch
import torch.nn.functional as F
from torchvision import transforms
from transformers import DINOv3ViTModel
import numpy as np
from PIL import Image


class DinoV2FeatureExtractor:
    """
    Feature extractor for DINOv2 models.
    """
    def __init__(self, model_name: str):
        self.model_name = model_name
        self.model = torch.hub.load('facebookresearch/dinov2', model_name, pretrained=True)
        self.model.eval()
        self.transform = transforms.Compose([
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def to(self, device):
        self.model.to(device)

    def cuda(self):
        self.model.cuda()

    def cpu(self):
        self.model.cpu()
    
    @torch.no_grad()
    def __call__(self, image: Union[torch.Tensor, List[Image.Image]]) -> torch.Tensor:
        """
        Extract features from the image.
        
        Args:
            image: A batch of images as a tensor of shape (B, C, H, W) or a list of PIL images.
        
        Returns:
            A tensor of shape (B, N, D) where N is the number of patches and D is the feature dimension.
        """
        if isinstance(image, torch.Tensor):
            assert image.ndim == 4, "Image tensor should be batched (B, C, H, W)"
        elif isinstance(image, list):
            assert all(isinstance(i, Image.Image) for i in image), "Image list should be list of PIL images"
            image = [i.resize((518, 518), Image.LANCZOS) for i in image]
            image = [np.array(i.convert('RGB')).astype(np.float32) / 255 for i in image]
            image = [torch.from_numpy(i).permute(2, 0, 1).float() for i in image]
            image = torch.stack(image).cuda()
        else:
            raise ValueError(f"Unsupported type of image: {type(image)}")
        
        image = self.transform(image).cuda()
        features = self.model(image, is_training=True)['x_prenorm']
        patchtokens = F.layer_norm(features, features.shape[-1:])
        return patchtokens
    

class DinoV3FeatureExtractor:
    """
    Feature extractor for DINOv3 models.
    """
    # Non-gated community mirror of facebook/dinov3-vitl16-pretrain-lvd1689m
    # (same LVD-1689M checkpoint, HF transformers format). Meta gates the
    # canonical repo, so an online from_pretrained() with no Meta token raises
    # GatedRepoError at generation time — a release blocker. This mirror lets
    # the online fallback path resolve with no token. Verified 2026-07-13:
    # config.json byte-identical to the canonical config (DINOv3ViTModel,
    # hidden_size 1024, 24 layers), model.safetensors 1.21 GB, repo public.
    _DEFAULT_MIRROR = 'camenduru/dinov3-vitl16-pretrain-lvd1689m'

    def __init__(self, model_name: str, image_size=512):
        import os
        # FABMESH_DINOV3_REPO repoints the backbone at a shipper-controlled /
        # alternative NON-GATED repo without editing the vendored gen configs.
        # Unset (default) → the id baked into the config; wizard_download stages
        # a non-gated mirror into that id's canonical HF cache so it resolves
        # with no Meta token.
        repo = os.environ.get('FABMESH_DINOV3_REPO', '').strip() or model_name
        self.model_name = repo
        try:
            # Prefer the pre-provisioned cache (wizard_download populated it).
            # local_files_only avoids the network HEAD that would 401 on the
            # Meta-gated canonical id even when the weights are cached locally
            # — the generation subprocess does NOT run with HF_HUB_OFFLINE set.
            self.model = DINOv3ViTModel.from_pretrained(
                repo, local_files_only=True)
        except Exception:
            # Unprovisioned env (e.g. a dev box that skipped the wizard): pull
            # online. Never fall back to the gated canonical id with no token —
            # use the non-gated mirror (or the explicit FABMESH_DINOV3_REPO).
            fallback = (os.environ.get('FABMESH_DINOV3_REPO', '').strip()
                        or self._DEFAULT_MIRROR)
            self.model = DINOv3ViTModel.from_pretrained(fallback)
            self.model_name = fallback
        self.model.eval()
        self.image_size = image_size
        self.transform = transforms.Compose([
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

    def to(self, device):
        self.model.to(device)

    def cuda(self):
        self.model.cuda()

    def cpu(self):
        self.model.cpu()

    def extract_features(self, image: torch.Tensor) -> torch.Tensor:
        image = image.to(self.model.embeddings.patch_embeddings.weight.dtype)
        hidden_states = self.model.embeddings(image, bool_masked_pos=None)
        position_embeddings = self.model.rope_embeddings(image)

        # transformers 5.x relocates the transformer layers under
        # model.model.layer (the inner encoder). Older transformers
        # 4.46 exposed them directly under model.layer.
        _layer_iter = (self.model.model.layer if hasattr(self.model, 'model')
                       else self.model.layer)
        for i, layer_module in enumerate(_layer_iter):
            hidden_states = layer_module(
                hidden_states,
                position_embeddings=position_embeddings,
            )

        return F.layer_norm(hidden_states, hidden_states.shape[-1:])
        
    @torch.no_grad()
    def __call__(self, image: Union[torch.Tensor, List[Image.Image]]) -> torch.Tensor:
        """
        Extract features from the image.
        
        Args:
            image: A batch of images as a tensor of shape (B, C, H, W) or a list of PIL images.
        
        Returns:
            A tensor of shape (B, N, D) where N is the number of patches and D is the feature dimension.
        """
        if isinstance(image, torch.Tensor):
            assert image.ndim == 4, "Image tensor should be batched (B, C, H, W)"
        elif isinstance(image, list):
            assert all(isinstance(i, Image.Image) for i in image), "Image list should be list of PIL images"
            image = [i.resize((self.image_size, self.image_size), Image.LANCZOS) for i in image]
            image = [np.array(i.convert('RGB')).astype(np.float32) / 255 for i in image]
            image = [torch.from_numpy(i).permute(2, 0, 1).float() for i in image]
            image = torch.stack(image).cuda()
        else:
            raise ValueError(f"Unsupported type of image: {type(image)}")
        
        image = self.transform(image).cuda()
        features = self.extract_features(image)
        return features
