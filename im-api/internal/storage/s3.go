package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/0Whisperos/whisper/im-server/internal/config"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

type S3Store struct {
	client      *s3.Client
	presigner   *s3.PresignClient
	bucket      string
	uploadTTL   time.Duration
	downloadTTL time.Duration
	now         func() time.Time
}

func NewS3(ctx context.Context, cfg config.StorageConfig) (*S3Store, error) {
	uploadTTL, err := cfg.UploadURLDuration()
	if err != nil {
		return nil, err
	}
	downloadTTL, err := cfg.DownloadURLDuration()
	if err != nil {
		return nil, err
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
		awsconfig.WithBaseEndpoint(cfg.Endpoint),
		// 部分 S3 兼容服务不支持 SDK 默认的流式校验和 trailer；仅在 API 明确要求时才计算请求校验和。
		awsconfig.WithRequestChecksumCalculation(aws.RequestChecksumCalculationWhenRequired),
	)
	if err != nil {
		return nil, fmt.Errorf("load S3 configuration: %v", err)
	}
	client := s3.NewFromConfig(awsCfg, func(options *s3.Options) {
		options.UsePathStyle = cfg.ForcePathStyle
	})
	return &S3Store{
		client:      client,
		presigner:   s3.NewPresignClient(client),
		bucket:      cfg.BucketName,
		uploadTTL:   uploadTTL,
		downloadTTL: downloadTTL,
		now:         time.Now,
	}, nil
}

func (store *S3Store) PresignPut(ctx context.Context, key, contentType string) (PresignedRequest, error) {
	result, err := store.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(store.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, func(options *s3.PresignOptions) {
		options.Expires = store.uploadTTL
	})
	if err != nil {
		return PresignedRequest{}, preserveContextError(ctx, "presign S3 PUT", err)
	}
	return PresignedRequest{
		Method:    result.Method,
		URL:       result.URL,
		Headers:   flattenHeaders(result.SignedHeader),
		ExpiresAt: store.now().UTC().Add(store.uploadTTL),
	}, nil
}

func (store *S3Store) PresignGet(ctx context.Context, key string) (PresignedRequest, error) {
	result, err := store.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(store.bucket),
		Key:    aws.String(key),
	}, func(options *s3.PresignOptions) {
		options.Expires = store.downloadTTL
	})
	if err != nil {
		return PresignedRequest{}, preserveContextError(ctx, "presign S3 GET", err)
	}
	return PresignedRequest{
		Method:    result.Method,
		URL:       result.URL,
		Headers:   flattenHeaders(result.SignedHeader),
		ExpiresAt: store.now().UTC().Add(store.downloadTTL),
	}, nil
}

func (store *S3Store) ReadObject(ctx context.Context, key string, maxBytes int64) (Object, error) {
	result, err := store.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(store.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return Object{}, mapS3Error(ctx, "read S3 object", err)
	}
	defer result.Body.Close()

	size := aws.ToInt64(result.ContentLength)
	if size > maxBytes {
		return Object{Size: size}, nil
	}
	data, err := io.ReadAll(io.LimitReader(result.Body, maxBytes+1))
	if err != nil {
		return Object{}, preserveContextError(ctx, "read S3 object body", err)
	}
	if size < 0 || int64(len(data)) != size {
		size = int64(len(data))
	}
	return Object{Size: size, Data: data}, nil
}

func (store *S3Store) WriteObject(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := store.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(store.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentLength: aws.Int64(int64(len(data))),
		ContentType:   aws.String(contentType),
	})
	if err != nil {
		return preserveContextError(ctx, "write S3 object", err)
	}
	return nil
}

func (store *S3Store) DeleteObject(ctx context.Context, key string) error {
	_, err := store.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(store.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return mapS3Error(ctx, "delete S3 object", err)
	}
	return nil
}

func flattenHeaders(headers http.Header) map[string]string {
	result := make(map[string]string, len(headers))
	for name, values := range headers {
		if strings.EqualFold(name, "host") || len(values) == 0 {
			continue
		}
		result[name] = strings.Join(values, ",")
	}
	return result
}

func mapS3Error(ctx context.Context, operation string, err error) error {
	var apiError smithy.APIError
	if errors.As(err, &apiError) && (apiError.ErrorCode() == "NoSuchKey" || apiError.ErrorCode() == "NotFound") {
		return fmt.Errorf("%s: %w", operation, ErrObjectNotFound)
	}
	return preserveContextError(ctx, operation, err)
}

func preserveContextError(ctx context.Context, operation string, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return fmt.Errorf("%s: %w", operation, ctxErr)
	}
	if errors.Is(err, context.Canceled) {
		return fmt.Errorf("%s: %w", operation, context.Canceled)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%s: %w", operation, context.DeadlineExceeded)
	}
	return fmt.Errorf("%s: %v", operation, err)
}
