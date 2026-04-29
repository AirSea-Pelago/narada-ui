from __future__ import division
import warnings
from Networks.HR_Net.seg_hrnet import get_seg_model
import torch.nn as nn
import torch.nn.functional as F
from torchvision import datasets, transforms
import dataset
import math
from image import *
from utils import *
import logging
import nni
from nni.utils import merge_parameter
from config import return_args, args
import time
from collections import Counter, defaultdict
import random

warnings.filterwarnings('ignore')
setup_seed(args.seed)

logger = logging.getLogger('mnist_AutoML')


# =============================================================================
# DENSITY-AWARE UTILITIES
# =============================================================================

def analyze_dataset_density(data_list):
    """
    Analyze density distribution of the dataset
    Returns density categories and weights for each sample
    """
    print("\n" + "="*70)
    print("ANALYZING DATASET DENSITY DISTRIBUTION")
    print("="*70)
    print(f"Analyzing {len(data_list)} samples...")
    
    density_info = []
    
    for idx, img_path in enumerate(data_list):
        if idx % 50 == 0:
            print(f"  Progress: {idx}/{len(data_list)}")
        
        # Load ground truth to get count
        gt_path = img_path.replace('.jpg', '.h5').replace('images', 'ground_truth')
        
        count = 0
        try:
            if os.path.exists(gt_path):
                with h5py.File(gt_path, 'r') as gt_file:
                    if 'kpoint' in gt_file:
                        count = np.sum(gt_file['kpoint'][()])
                    elif 'image_info' in gt_file:
                        # ShanghaiTech format
                        count = len(gt_file['image_info'][0,0][0,0][0])
                    elif 'gt_count' in gt_file:
                        count = gt_file['gt_count'][()]
                    else:
                        # Try to count from other keys
                        for key in gt_file.keys():
                            try:
                                count = len(gt_file[key][()])
                                break
                            except:
                                continue
            else:
                # Try alternative paths
                alt_paths = [
                    img_path.replace('.jpg', '.h5').replace('images', 'ground-truth'),
                    img_path.replace('.jpg', '_ann.h5'),
                ]
                for alt_path in alt_paths:
                    if os.path.exists(alt_path):
                        with h5py.File(alt_path, 'r') as gt_file:
                            for key in gt_file.keys():
                                try:
                                    count = len(gt_file[key][()])
                                    break
                                except:
                                    continue
                        break
        except Exception as e:
            print(f"    Warning: Could not read {gt_path}: {e}")
            count = 0
        except Exception as e:
            print(f"    Warning: Could not read {gt_path}: {e}")
            count = 0
        
        # Categorize density
        if count < 10:
            category = 'sparse'
        elif count < 50:
            category = 'medium-sparse'
        elif count < 150:
            category = 'medium'
        elif count < 300:
            category = 'medium-dense'
        else:
            category = 'dense'
        
        density_info.append({
            'path': img_path,
            'count': count,
            'category': category
        })
    
    print(f"  Completed: {len(data_list)}/{len(data_list)}")
    
    # Calculate statistics
    categories = [info['category'] for info in density_info]
    category_counts = Counter(categories)
    total = len(density_info)
    
    print(f"\nDataset: {total} samples")
    print("-"*70)
    for cat in ['sparse', 'medium-sparse', 'medium', 'medium-dense', 'dense']:
        count = category_counts.get(cat, 0)
        pct = count / total * 100 if total > 0 else 0
        print(f"{cat:15s}: {count:4d} samples ({pct:5.1f}%)")
    
    # Calculate sampling weights
    if len(category_counts) == 0:
        print("\n⚠️  WARNING: No density information extracted!")
        print("    All samples will have equal weight.")
        sample_weights = [1.0] * len(density_info)
        print("="*70 + "\n")
        return density_info, sample_weights
    
    max_count = max(category_counts.values())
    category_weights = {}
    
    for cat, count in category_counts.items():
        if count > 0:
            # Inverse frequency with sqrt dampening
            raw_weight = max_count / count
            category_weights[cat] = np.sqrt(raw_weight)
        else:
            category_weights[cat] = 1.0
    
    # Extra boost for sparse categories (CRITICAL for your use case)
    category_weights['sparse'] = category_weights.get('sparse', 1.0) * 3.0
    category_weights['medium-sparse'] = category_weights.get('medium-sparse', 1.0) * 1.5
    
    print("\nSampling weights (higher = sampled more often):")
    print("-"*70)
    for cat in ['sparse', 'medium-sparse', 'medium', 'medium-dense', 'dense']:
        weight = category_weights.get(cat, 1.0)
        print(f"{cat:15s}: {weight:.2f}x")
    
    # Assign weights to each sample
    sample_weights = [category_weights[info['category']] for info in density_info]
    
    print("="*70 + "\n")
    
    return density_info, sample_weights


def create_density_weighted_sampler(sample_weights):
    """
    Create a WeightedRandomSampler for density-aware training
    """
    from torch.utils.data import WeightedRandomSampler
    
    sampler = WeightedRandomSampler(
        weights=sample_weights,
        num_samples=len(sample_weights),
        replacement=True
    )
    return sampler


class DensityAwareLoss(nn.Module):
    """
    Loss function that weights samples based on density
    Gives higher weight to sparse samples
    """
    def __init__(self, base_loss=nn.MSELoss(reduction='none')):
        super().__init__()
        self.base_loss = base_loss
    
    def forward(self, pred, target, density_weights=None):
        """
        Args:
            pred: predicted FIDT map [B, 1, H, W]
            target: ground truth FIDT map [B, 1, H, W]
            density_weights: per-sample weights [B] (optional)
        """
        # Calculate base loss
        loss = self.base_loss(pred, target)
        
        # Reduce spatial dimensions
        loss = loss.mean(dim=[1, 2, 3])  # [B]
        
        # Apply density weights if provided
        if density_weights is not None:
            loss = loss * density_weights
        
        return loss.mean()


class DensityAwareAugmentation:
    """
    Augmentation strategy that creates more sparse scenarios
    """
    def __init__(self, sparse_crop_prob=0.3, isolation_crop_prob=0.2):
        self.sparse_crop_prob = sparse_crop_prob
        self.isolation_crop_prob = isolation_crop_prob
    
    def __call__(self, img, fidt_map, kpoint, density_category):
        """
        Apply density-aware augmentation
        """
        # For sparse samples, apply special augmentation
        if density_category in ['sparse', 'medium-sparse']:
            # Less aggressive cropping to preserve context
            if random.random() < self.sparse_crop_prob:
                img, fidt_map, kpoint = self._gentle_crop(img, fidt_map, kpoint)
        
        # For all samples, occasionally create isolation crops
        if random.random() < self.isolation_crop_prob:
            img, fidt_map, kpoint = self._isolation_crop(img, fidt_map, kpoint)
        
        return img, fidt_map, kpoint
    
    def _gentle_crop(self, img, fidt_map, kpoint):
        """Crop that preserves most of the scene"""
        h, w, _ = img.shape
        
        # Only crop 20-30% from edges
        crop_ratio = random.uniform(0.7, 0.8)
        new_h = int(h * crop_ratio)
        new_w = int(w * crop_ratio)
        
        y = random.randint(0, h - new_h)
        x = random.randint(0, w - new_w)
        
        img = img[y:y+new_h, x:x+new_w]
        fidt_map = fidt_map[y:y+new_h, x:x+new_w]
        kpoint = kpoint[y:y+new_h, x:x+new_w]
        
        return img, fidt_map, kpoint
    
    def _isolation_crop(self, img, fidt_map, kpoint):
        """
        Create crops that might isolate individuals
        This helps the model learn to detect sparse scenarios
        """
        h, w, _ = img.shape
        
        # Find person locations
        person_locs = np.argwhere(kpoint > 0)
        
        if len(person_locs) == 0:
            return img, fidt_map, kpoint
        
        # Random crop size (smaller to potentially isolate)
        crop_h = random.randint(h // 3, h // 2)
        crop_w = random.randint(w // 3, w // 2)
        
        # Try to center on a random person
        if random.random() < 0.5 and len(person_locs) > 0:
            center_idx = random.randint(0, len(person_locs) - 1)
            center_y, center_x = person_locs[center_idx]
            
            y = max(0, min(h - crop_h, center_y - crop_h // 2))
            x = max(0, min(w - crop_w, center_x - crop_w // 2))
        else:
            # Random crop
            y = random.randint(0, max(0, h - crop_h))
            x = random.randint(0, max(0, w - crop_w))
        
        img = img[y:y+crop_h, x:x+crop_w]
        fidt_map = fidt_map[y:y+crop_h, x:x+crop_w]
        kpoint = kpoint[y:y+crop_h, x:x+crop_w]
        
        return img, fidt_map, kpoint


# =============================================================================
# MODIFIED MAIN TRAINING FUNCTION
# =============================================================================

def main(args):
    # Load dataset paths
    if args['dataset'] == 'ShanghaiA':
        train_file = './npydata/ShanghaiA_train.npy'
        test_file = './npydata/ShanghaiA_test.npy'
    elif args['dataset'] == 'ShanghaiB':
        train_file = './npydata/ShanghaiB_train.npy'
        test_file = './npydata/ShanghaiB_test.npy'
    elif args['dataset'] == 'UCF_QNRF':
        train_file = './npydata/qnrf_train.npy'
        test_file = './npydata/qnrf_test.npy'
    elif args['dataset'] == 'JHU':
        train_file = './npydata/jhu_train.npy'
        test_file = './npydata/jhu_val.npy'
    elif args['dataset'] == 'NWPU':
        train_file = './npydata/nwpu_train.npy'
        test_file = './npydata/nwpu_val.npy'

    with open(train_file, 'rb') as outfile:
        train_list = np.load(outfile).tolist()
    with open(test_file, 'rb') as outfile:
        test_list = np.load(outfile).tolist()

    # DENSITY ANALYSIS - with timeout/skip option
    use_density_analysis = args.get('use_density_analysis', True)
    
    if use_density_analysis:
        try:
            print("\nAnalyzing training set density...")
            train_density_info, train_sample_weights = analyze_dataset_density(train_list)
            
            print("\nAnalyzing test set density...")
            test_density_info, _ = analyze_dataset_density(test_list)
        except Exception as e:
            print(f"\n⚠️  Density analysis failed: {e}")
            print("    Falling back to uniform sampling...")
            train_density_info = [{'path': p, 'count': 0, 'category': 'unknown'} for p in train_list]
            train_sample_weights = [1.0] * len(train_list)
            use_density_analysis = False
    else:
        print("\n⚠️  Density analysis disabled, using uniform sampling")
        train_density_info = [{'path': p, 'count': 0, 'category': 'unknown'} for p in train_list]
        train_sample_weights = [1.0] * len(train_list)

    os.environ['CUDA_VISIBLE_DEVICES'] = args['gpu_id']
    model = get_seg_model(train=True)
    model = nn.DataParallel(model, device_ids=[0])
    model = model.cuda()

    # MODIFIED: Conservative optimizer for fine-tuning
    if args['pre']:
        # Fine-tuning: use much lower learning rate
        print("\n⚠️  FINE-TUNING MODE: Using reduced learning rate")
        finetune_lr = args['lr'] * 0.1  # 10x lower
        print(f"Base LR: {args['lr']} -> Fine-tune LR: {finetune_lr}")
        
        optimizer = torch.optim.Adam(
            model.parameters(), 
            lr=finetune_lr, 
            weight_decay=args['weight_decay']
        )
    else:
        # Training from scratch
        optimizer = torch.optim.Adam(
            model.parameters(), 
            lr=args['lr'], 
            weight_decay=args['weight_decay']
        )

    # MODIFIED: Density-aware loss
    criterion = DensityAwareLoss(base_loss=nn.MSELoss(reduction='none')).cuda()

    print(args['pre'])

    if not os.path.exists(args['save_path']):
        os.makedirs(args['save_path'])

    # Load pretrained model
    if args['pre']:
        if os.path.isfile(args['pre']):
            print("=> loading checkpoint '{}'".format(args['pre']))
            checkpoint = torch.load(args['pre'])
            model.load_state_dict(checkpoint['state_dict'], strict=False)
            args['start_epoch'] = checkpoint['epoch']
            args['best_pred'] = checkpoint['best_prec1']
            
            # OPTIONAL: Freeze backbone for first N epochs
            if args.get('freeze_backbone', False):
                print("\n🔒 FREEZING BACKBONE for stable fine-tuning")
                for name, param in model.named_parameters():
                    if 'backbone' in name or 'stem' in name or 'stage' in name:
                        param.requires_grad = False
                print("Only training head layers\n")
        else:
            print("=> no checkpoint found at '{}'".format(args['pre']))

    torch.set_num_threads(args['workers'])
    print(args['best_pred'], args['start_epoch'])

    # Preload data with density information
    if args['preload_data'] == True:
        print("\nPreloading training data...")
        if use_density_analysis:
            train_data = pre_data_with_density(train_list, train_density_info, args, train=True)
        else:
            train_data = pre_data(train_list, args, train=True)
            # Add dummy density info
            for key in train_data:
                train_data[key]['density_category'] = 'unknown'
                train_data[key]['crowd_count'] = 0
        
        print("Preloading test data...")
        test_data = pre_data(test_list, args, train=False)
    else:
        train_data = train_list
        test_data = test_list
        use_density_analysis = False  # Can't use density without preloaded data

    # Early stopping
    patience = args.get('patience', 20)
    patience_counter = 0
    best_mae_ever = args['best_pred']

    # Training loop
    for epoch in range(args['start_epoch'], args['epochs']):
        start = time.time()
        
        # Train with density-aware sampling if available
        if use_density_analysis and args['preload_data']:
            train_density_aware(
                train_data, train_sample_weights, model, 
                criterion, optimizer, epoch, args
            )
        else:
            # Fallback to regular training
            print("\n⚠️  Using standard training (no density awareness)")
            train(train_data, model, criterion, optimizer, epoch, args)
        
        end1 = time.time()

        # Validation
        if epoch % 10 == 0 and epoch >= 200:
            prec1, visi = validate(test_data, model, args)
            end2 = time.time()

            is_best = prec1 < args['best_pred']
            args['best_pred'] = min(prec1, args['best_pred'])

            print(' * best MAE {mae:.3f} '.format(mae=args['best_pred']), 
                  args['save_path'], end1 - start, end2 - end1)

            save_checkpoint({
                'epoch': epoch + 1,
                'arch': args['pre'],
                'state_dict': model.state_dict(),
                'best_prec1': args['best_pred'],
                'optimizer': optimizer.state_dict(),
            }, visi, is_best, args['save_path'])

            # Early stopping check
            if prec1 < best_mae_ever:
                best_mae_ever = prec1
                patience_counter = 0
                print(f"✓ New best MAE: {best_mae_ever:.3f}")
            else:
                patience_counter += 1
                print(f"No improvement for {patience_counter}/{patience} epochs")
                
                if patience_counter >= patience:
                    print(f"\n⚠️  EARLY STOPPING at epoch {epoch}")
                    print(f"Best MAE achieved: {best_mae_ever:.3f}")
                    break


def pre_data_with_density(train_list, density_info, args, train):
    """Modified pre_data that includes density information"""
    print("Pre_load dataset with density info......")
    data_keys = {}
    count = 0
    total = len(train_list)
    
    # Create density lookup
    density_lookup = {info['path']: info for info in density_info}
    
    for j in range(len(train_list)):
        # Progress indicator
        if j % 10 == 0 or j == total - 1:
            print(f"  Loading: {j+1}/{total} ({(j+1)/total*100:.1f}%)", end='\r')
        
        Img_path = train_list[j]
        fname = os.path.basename(Img_path)
        
        try:
            img, fidt_map, kpoint = load_data_fidt(Img_path, args, train)
        except Exception as e:
            print(f"\n  ⚠️  Failed to load {fname}: {e}")
            continue

        if min(fidt_map.shape[0], fidt_map.shape[1]) < 256 and train == True:
            continue
        
        blob = {}
        blob['img'] = img
        blob['kpoint'] = np.array(kpoint)
        blob['fidt_map'] = fidt_map
        blob['fname'] = fname
        
        # Add density information
        if Img_path in density_lookup:
            blob['density_category'] = density_lookup[Img_path]['category']
            blob['crowd_count'] = density_lookup[Img_path]['count']
        else:
            blob['density_category'] = 'unknown'
            blob['crowd_count'] = 0
        
        data_keys[count] = blob
        count += 1
    
    print(f"\n  Loaded {count}/{total} samples successfully")
    return data_keys


def pre_data(train_list, args, train):
    """Original pre_data function (for test data)"""
    print("Pre_load dataset ......")
    data_keys = {}
    count = 0
    total = len(train_list)
    
    for j in range(len(train_list)):
        # Progress indicator
        if j % 10 == 0 or j == total - 1:
            print(f"  Loading: {j+1}/{total} ({(j+1)/total*100:.1f}%)", end='\r')
        
        Img_path = train_list[j]
        fname = os.path.basename(Img_path)
        
        try:
            img, fidt_map, kpoint = load_data_fidt(Img_path, args, train)
        except Exception as e:
            print(f"\n  ⚠️  Failed to load {fname}: {e}")
            continue

        if min(fidt_map.shape[0], fidt_map.shape[1]) < 256 and train == True:
            continue
        
        blob = {}
        blob['img'] = img
        blob['kpoint'] = np.array(kpoint)
        blob['fidt_map'] = fidt_map
        blob['fname'] = fname
        data_keys[count] = blob
        count += 1
    
    print(f"\n  Loaded {count}/{total} samples successfully")
    return data_keys


def train(Pre_data, model, criterion, optimizer, epoch, args):
    """Fallback standard training without density awareness"""
    losses = AverageMeter()
    batch_time = AverageMeter()
    data_time = AverageMeter()

    train_loader = torch.utils.data.DataLoader(
        dataset.listDataset(Pre_data, args['save_path'],
                            shuffle=True,
                            transform=transforms.Compose([
                                transforms.ToTensor(),
                                transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                                     std=[0.229, 0.224, 0.225]),
                            ]),
                            train=True,
                            batch_size=args['batch_size'],
                            num_workers=args['workers'],
                            args=args),
        batch_size=args['batch_size'], drop_last=False)
    
    args['lr'] = optimizer.param_groups[0]['lr']
    print('epoch %d, processed %d samples, lr %.10f' % (epoch, epoch * len(train_loader.dataset), args['lr']))

    model.train()
    end = time.time()

    for i, (fname, img, fidt_map, kpoint) in enumerate(train_loader):
        data_time.update(time.time() - end)
        img = img.cuda()
        fidt_map = fidt_map.type(torch.FloatTensor).unsqueeze(1).cuda()

        d6 = model(img)

        if d6.shape != fidt_map.shape:
            print("the shape is wrong, please check. Both of prediction and GT should be [B, C, H, W].")
            exit()
        
        # Use standard MSE loss
        loss = nn.functional.mse_loss(d6, fidt_map)
        losses.update(loss.item(), img.size(0))
        
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        batch_time.update(time.time() - end)
        end = time.time()

        if i % args['print_freq'] == 0:
            print('4_Epoch: [{0}][{1}/{2}]\t'
                  'Time {batch_time.val:.3f} ({batch_time.avg:.3f})\t'
                  'Data {data_time.val:.3f} ({data_time.avg:.3f})\t'
                  'Loss {loss.val:.4f} ({loss.avg:.4f})\t'
                .format(
                epoch, i, len(train_loader), batch_time=batch_time,
                data_time=data_time, loss=losses))


def train_density_aware(Pre_data, sample_weights, model, criterion, optimizer, epoch, args):
    """
    Density-aware training loop
    """
    losses = AverageMeter()
    batch_time = AverageMeter()
    data_time = AverageMeter()
    
    # Track losses by density category
    density_losses = defaultdict(lambda: AverageMeter())

    # Create weighted sampler
    sampler = create_density_weighted_sampler(sample_weights)
    
    train_loader = torch.utils.data.DataLoader(
        dataset.listDataset(Pre_data, args['save_path'],
                            shuffle=False,  # Don't shuffle when using sampler
                            transform=transforms.Compose([
                                transforms.ToTensor(),
                                transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                                     std=[0.229, 0.224, 0.225]),
                            ]),
                            train=True,
                            batch_size=args['batch_size'],
                            num_workers=args['workers'],
                            args=args),
        batch_size=args['batch_size'], 
        sampler=sampler,  # Use density-aware sampler
        drop_last=False
    )
    
    args['lr'] = optimizer.param_groups[0]['lr']
    print('epoch %d, processed %d samples, lr %.10f' % 
          (epoch, epoch * len(train_loader.dataset), args['lr']))

    model.train()
    end = time.time()

    # Density-aware augmentation
    augmentor = DensityAwareAugmentation(
        sparse_crop_prob=0.3,
        isolation_crop_prob=0.2
    )

    for i, (fname, img, fidt_map, kpoint) in enumerate(train_loader):
        data_time.update(time.time() - end)
        
        img = img.cuda()
        fidt_map = fidt_map.type(torch.FloatTensor).unsqueeze(1).cuda()

        # Get density categories for this batch
        batch_categories = []
        batch_weights = []
        for f in fname:
            # Find density category from Pre_data
            for key, blob in Pre_data.items():
                if blob['fname'] == f:
                    category = blob.get('density_category', 'unknown')
                    batch_categories.append(category)
                    
                    # Assign loss weight based on category
                    if category == 'sparse':
                        batch_weights.append(3.0)
                    elif category == 'medium-sparse':
                        batch_weights.append(1.5)
                    else:
                        batch_weights.append(1.0)
                    break
        
        batch_weights = torch.tensor(batch_weights, device=img.device)

        # Forward pass
        d6 = model(img)

        if d6.shape != fidt_map.shape:
            print("Shape mismatch: prediction and GT should be [B, C, H, W]")
            exit()
        
        # Calculate density-aware loss
        loss = criterion(d6, fidt_map, density_weights=batch_weights)

        losses.update(loss.item(), img.size(0))
        
        # Track loss by density category
        for category in batch_categories:
            if category != 'unknown':
                density_losses[category].update(loss.item(), 1)

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        batch_time.update(time.time() - end)
        end = time.time()

        if i % args['print_freq'] == 0:
            print('Epoch: [{0}][{1}/{2}]\t'
                  'Time {batch_time.val:.3f} ({batch_time.avg:.3f})\t'
                  'Data {data_time.val:.3f} ({data_time.avg:.3f})\t'
                  'Loss {loss.val:.4f} ({loss.avg:.4f})\t'
                .format(epoch, i, len(train_loader), 
                       batch_time=batch_time, data_time=data_time, loss=losses))
    
    # Print density-specific losses
    print("\nLoss by density category:")
    for cat in ['sparse', 'medium-sparse', 'medium', 'medium-dense', 'dense']:
        if cat in density_losses:
            print(f"  {cat:15s}: {density_losses[cat].avg:.4f}")


def validate(Pre_data, model, args):
    """Original validation function"""
    print('begin test')
    batch_size = 1
    test_loader = torch.utils.data.DataLoader(
        dataset.listDataset(Pre_data, args['save_path'],
                            shuffle=False,
                            transform=transforms.Compose([
                                transforms.ToTensor(), 
                                transforms.Normalize(mean=[0.485, 0.456, 0.406],
                                                    std=[0.229, 0.224, 0.225]),
                            ]),
                            args=args, train=False),
        batch_size=1)

    model.eval()

    mae = 0.0
    mse = 0.0
    visi = []
    index = 0

    if not os.path.exists('./local_eval/loc_file'):
        os.makedirs('./local_eval/loc_file')

    f_loc = open("./local_eval/A_localization.txt", "w+")

    for i, (fname, img, fidt_map, kpoint) in enumerate(test_loader):
        count = 0
        img = img.cuda()

        if len(img.shape) == 5:
            img = img.squeeze(0)
        if len(fidt_map.shape) == 5:
            fidt_map = fidt_map.squeeze(0)
        if len(img.shape) == 3:
            img = img.unsqueeze(0)
        if len(fidt_map.shape) == 3:
            fidt_map = fidt_map.unsqueeze(0)

        with torch.no_grad():
            d6 = model(img)
            count, pred_kpoint, f_loc = LMDS_counting(d6, i + 1, f_loc, args)
            point_map = generate_point_map(pred_kpoint, f_loc, rate=1)

            if args['visual'] == True:
                if not os.path.exists(args['save_path'] + '_box/'):
                    os.makedirs(args['save_path'] + '_box/')
                ori_img, box_img = generate_bounding_boxes(pred_kpoint, fname)
                show_fidt = show_map(d6.data.cpu().numpy())
                gt_show = show_map(fidt_map.data.cpu().numpy())
                res = np.hstack((ori_img, gt_show, show_fidt, point_map, box_img))
                cv2.imwrite(args['save_path'] + '_box/' + fname[0], res)

        gt_count = torch.sum(kpoint).item()
        mae += abs(gt_count - count)
        mse += abs(gt_count - count) * abs(gt_count - count)

        if i % 15 == 0:
            print('{fname} Gt {gt:.2f} Pred {pred}'.format(
                fname=fname[0], gt=gt_count, pred=count))
            visi.append([img.data.cpu().numpy(), d6.data.cpu().numpy(), 
                        fidt_map.data.cpu().numpy(), fname])
            index += 1

    mae = mae * 1.0 / (len(test_loader) * batch_size)
    mse = math.sqrt(mse / (len(test_loader)) * batch_size)

    nni.report_intermediate_result(mae)
    print(' \n* MAE {mae:.3f}\n'.format(mae=mae), '* MSE {mse:.3f}'.format(mse=mse))

    return mae, visi


def LMDS_counting(input, w_fname, f_loc, args):
    """Original LMDS counting function"""
    input_max = torch.max(input).item()

    if args['dataset'] == 'UCF_QNRF':
        input = nn.functional.avg_pool2d(input, (3, 3), stride=1, padding=1)
        keep = nn.functional.max_pool2d(input, (3, 3), stride=1, padding=1)
    else:
        keep = nn.functional.max_pool2d(input, (3, 3), stride=1, padding=1)
    
    keep = (keep == input).float()
    input = keep * input

    input[input < 100.0 / 255.0 * input_max] = 0
    input[input > 0] = 1

    if input_max < 0.1:
        input = input * 0

    count = int(torch.sum(input).item())
    kpoint = input.data.squeeze(0).squeeze(0).cpu().numpy()
    f_loc.write('{} {} '.format(w_fname, count))
    
    return count, kpoint, f_loc


def generate_point_map(kpoint, f_loc, rate=1):
    """Original point map generation"""
    pred_coor = np.nonzero(kpoint)
    point_map = np.zeros((int(kpoint.shape[0] * rate), 
                          int(kpoint.shape[1] * rate), 3), 
                         dtype="uint8") + 255
    coord_list = []
    
    for i in range(0, len(pred_coor[0])):
        h = int(pred_coor[0][i] * rate)
        w = int(pred_coor[1][i] * rate)
        coord_list.append([w, h])
        cv2.circle(point_map, (w, h), 2, (0, 0, 0), -1)

    for data in coord_list:
        f_loc.write('{} {} '.format(math.floor(data[0]), math.floor(data[1])))
    f_loc.write('\n')

    return point_map


def generate_bounding_boxes(kpoint, fname):
    """Original bounding box generation"""
    # Modify path as needed
    Img_data = cv2.imread(
        '/path/to/your/images/' + fname[0])
    ori_Img_data = Img_data.copy()

    pts = np.array(list(zip(np.nonzero(kpoint)[1], np.nonzero(kpoint)[0])))
    leafsize = 2048
    tree = scipy.spatial.KDTree(pts.copy(), leafsize=leafsize)

    distances, locations = tree.query(pts, k=4)
    for index, pt in enumerate(pts):
        pt2d = np.zeros(kpoint.shape, dtype=np.float32)
        pt2d[pt[1], pt[0]] = 1.
        
        if np.sum(kpoint) > 1:
            sigma = (distances[index][1] + distances[index][2] + 
                    distances[index][3]) * 0.1
        else:
            sigma = np.average(np.array(kpoint.shape)) / 2. / 2.
        
        sigma = min(sigma, min(Img_data.shape[0], Img_data.shape[1]) * 0.05)
        t = 2
        
        Img_data = cv2.rectangle(Img_data, 
                                (int(pt[0] - sigma), int(pt[1] - sigma)),
                                (int(pt[0] + sigma), int(pt[1] + sigma)), 
                                (0, 255, 0), t)

    return ori_Img_data, Img_data


def show_map(input):
    """Original heatmap visualization"""
    input[input < 0] = 0
    input = input[0][0]
    fidt_map1 = input
    fidt_map1 = fidt_map1 / np.max(fidt_map1) * 255
    fidt_map1 = fidt_map1.astype(np.uint8)
    fidt_map1 = cv2.applyColorMap(fidt_map1, 2)
    return fidt_map1


class AverageMeter(object):
    """Computes and stores the average and current value"""
    def __init__(self):
        self.reset()

    def reset(self):
        self.val = 0
        self.avg = 0
        self.sum = 0
        self.count = 0

    def update(self, val, n=1):
        self.val = val
        self.sum += val * n
        self.count += n
        self.avg = self.sum / self.count


if __name__ == '__main__':
    tuner_params = nni.get_next_parameter()
    logger.debug(tuner_params)
    params = vars(merge_parameter(return_args, tuner_params))
    
    # Add density-aware training parameters
    params['patience'] = params.get('patience', 20)
    params['freeze_backbone'] = params.get('freeze_backbone', False)
    
    print(params)
    main(params)