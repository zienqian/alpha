package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"cloud-agent-server/internal/middleware"
)

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func respondOK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{
		"data":       data,
		"request_id": middleware.GetRequestID(c),
	})
}

func respondCreated(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, gin.H{
		"data":       data,
		"request_id": middleware.GetRequestID(c),
	})
}

func respondError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{
		"error": apiError{
			Code:    code,
			Message: message,
		},
		"request_id": middleware.GetRequestID(c),
	})
}
